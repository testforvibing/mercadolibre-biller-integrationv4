/**
 * ============================================================
 * SERVIDOR PRINCIPAL - INTEGRACION WIX <-> BILLER
 * Uruguay - Facturacion Electronica
 * ============================================================
 */

require('dotenv').config();

const express = require('express');
const config = require('./config');
const { BillerClient } = require('./biller-client');
const { getWixClient, exchangeCodeForTokens, refreshAccessToken } = require('./wix-client');
const logger = require('./utils/logger');
const { getComprobanteStore, WebhookDedupeStore } = require('./utils/store');
const { getWebhookQueue } = require('./utils/webhook-queue');
const { CircuitBreaker } = require('./utils/circuit-breaker-v2');
const { getMetrics } = require('./monitoring/prometheus-metrics');
const path = require('path');

// Servicios
const { determinarTipoComprobante } = require('./services/billing-decision');
const { procesarCancelacion, procesarRefund, debeEmitirNC } = require('./services/credit-note-service');
const { formatDateForBiller, parseMontoSeguro, truncateForBiller, BILLER_FIELD_LIMITS } = require('./utils/date-formatter');

// Rutas de Wix App
const wixAppApiRoutes = require('./routes/wix-app-api');
const customerApiRoutes = require('./routes/customer-api');

// Error store (si existe)
let errorStore, ERROR_TYPES, SEVERITY_LEVELS;
try {
  const errorModule = require('./utils/error-store');
  errorStore = errorModule.getErrorStore();
  ERROR_TYPES = errorModule.ERROR_TYPES;
  SEVERITY_LEVELS = errorModule.SEVERITY_LEVELS;
} catch (e) {
  // Error store opcional
  errorStore = {
    addError: () => {},
    getErrors: () => [],
    getStats: () => ({ lastHour: { total: 0 }, last24h: { total: 0, byType: {}, bySeverity: {} }, unresolved: 0 })
  };
  ERROR_TYPES = { WEBHOOK: 'webhook', BILLER: 'biller' };
  SEVERITY_LEVELS = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
}

// ============================================================
// INICIALIZACION
// ============================================================

const app = express();
const biller = new BillerClient();
const wixClient = getWixClient();
const comprobanteStore = getComprobanteStore();
const webhookQueue = getWebhookQueue();
const webhookDedupe = new WebhookDedupeStore(config.procesamiento?.dedupeWindow || 300000);

// Prometheus metrics (opcional)
let prometheusMetrics;
try {
  prometheusMetrics = getMetrics();
} catch (e) {
  prometheusMetrics = {
    inc: () => {},
    set: () => {},
    startTimer: () => () => {},
    export: () => ''
  };
}

// Circuit Breaker para Biller API
const billerCircuit = new CircuitBreaker('biller-api', {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000,
  fallback: (error) => {
    logger.error('Biller API circuit breaker activado', { error: error.message });
    throw error;
  }
});

// Metricas
const metrics = {
  webhooksRecibidos: 0,
  webhooksProcesados: 0,
  comprobantesEmitidos: 0,
  ncEmitidas: 0,
  errores: 0,
  startTime: Date.now()
};

// ============================================================
// MIDDLEWARE
// ============================================================

// Middleware para parsear JSON y capturar body raw para webhooks
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Middleware para texto plano (webhooks JWT)
app.use(express.text({ type: 'application/jwt' }));

// Logging de requests
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (!req.path.startsWith('/webhooks')) {
      logger.request(req.method, req.path, res.statusCode, Date.now() - start);
    }
  });
  next();
});

// Servir archivos estaticos
app.use('/static', express.static(path.join(__dirname, 'public')));

// ============================================================
// WIX APP API ROUTES
// ============================================================

// Dashboard API para Wix App (requiere autenticacion)
app.use('/api/wix-app', wixAppApiRoutes);

// Customer API para widget (publico con CORS)
app.use('/api/customer', customerApiRoutes);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', async (req, res) => {
  try {
    const billerStatus = await biller.verificarConexion();
    const wixStatus = await wixClient.verificarConexion();

    res.json({
      status: 'ok',
      service: 'Wix-Biller Integration',
      version: '1.0.0',
      uptime: Math.round((Date.now() - metrics.startTime) / 1000),
      biller: billerStatus,
      wix: wixStatus,
      features: {
        regla5000UI: true,
        notasCredito: true,
        circuitBreaker: true
      },
      circuitBreakers: {
        biller: billerCircuit.getState()
      }
    });
  } catch (error) {
    res.status(503).json({ status: 'error', error: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'Wix-Biller Integration',
    version: '2.0.0',
    environment: config.biller.environment,
    features: [
      'Facturacion automatica de ventas Wix',
      'Regla DGI 5000 UI implementada',
      'Notas de Credito por cancelaciones/refunds',
      'Cola persistente de webhooks',
      'Circuit Breaker para APIs',
      'Wix App Dashboard API',
      'Customer Invoice Widget'
    ],
    endpoints: {
      health: '/health',
      webhooks: '/webhooks/wix',
      auth: '/auth/wix',
      comprobantes: '/api/comprobantes',
      notasCredito: '/api/notas-credito',
      dashboard: '/api/dashboard',
      metrics: '/metrics',
      wixApp: {
        dashboard: '/api/wix-app/dashboard',
        invoices: '/api/wix-app/invoices',
        settings: '/api/wix-app/settings'
      },
      customerWidget: {
        invoices: '/api/customer/invoices?email=...',
        pdf: '/api/customer/invoice/:id/pdf?email=...'
      }
    }
  });
});

// Metricas Prometheus
app.get('/metrics', (req, res) => {
  prometheusMetrics.set('uptime_seconds', Math.floor((Date.now() - metrics.startTime) / 1000));
  prometheusMetrics.set('webhooks_queue_pending', webhookQueue.getStats().pending);
  prometheusMetrics.set('webhooks_queue_dead', webhookQueue.getStats().dead);

  res.set('Content-Type', 'text/plain');
  res.send(prometheusMetrics.export());
});

// ============================================================
// WEBHOOK WIX - RECEPCION DE EVENTOS
// ============================================================

app.post('/webhooks/wix', async (req, res) => {
  const endTimer = prometheusMetrics.startTimer('webhook_processing_duration_seconds');

  metrics.webhooksRecibidos++;
  prometheusMetrics.inc('webhooks_received_total');

  // 1. Obtener el token JWT (puede venir en body o header)
  let jwtToken = req.rawBody || req.body;
  if (typeof jwtToken === 'object') {
    jwtToken = JSON.stringify(jwtToken);
  }

  // Si viene como header x-wix-signature
  if (req.headers['x-wix-signature']) {
    jwtToken = req.headers['x-wix-signature'];
  }

  logger.info('Webhook Wix recibido', { contentType: req.headers['content-type'] });

  // 2. Responder rapido (Wix espera 200 OK rapido)
  res.status(200).json({ received: true });

  try {
    // 3. Verificar y decodificar JWT
    let payload;
    try {
      payload = wixClient.verifyWebhook(jwtToken);
    } catch (error) {
      logger.error('Error verificando webhook JWT', { error: error.message });
      metrics.errores++;
      return;
    }

    // Extraer datos del webhook (compatible con formato Wix)
    // Wix envia: { data: { order: {...} }, metadata: { eventType: "wix.ecom.v1.order_approved" } }
    const { data, metadata } = payload;

    // Obtener eventType (puede venir en metadata.eventType o directamente)
    const eventType = metadata?.eventType || payload.eventType || payload.slug;

    // Extraer slug: "wix.ecom.v1.order_approved" -> "approved"
    const slug = eventType?.split('.').pop()?.replace('order_', '') || eventType;

    // Obtener orderId de diferentes ubicaciones posibles
    const orderId = data?.order?.id || data?.orderId || payload.entityId || payload.orderId;

    // Event ID para tracking
    const eventId = metadata?.eventId || payload.id || `wix-${Date.now()}`;

    logger.info('Webhook Wix procesando', { eventId, eventType, slug, orderId });

    // 4. Encolar para persistencia
    const queueId = await webhookQueue.add({ slug, orderId, eventId, payload });

    // 5. Deduplicacion
    const dedupeKey = `wix-${slug}-${orderId}`;
    if (!webhookDedupe.tryAcquire(dedupeKey, eventId)) {
      webhookQueue.complete(queueId);
      logger.debug('Webhook duplicado', { slug, orderId, eventId });
      return;
    }

    // 6. Procesar segun tipo de evento
    const eventosEmitir = config.wix.webhookEvents.emitir;
    const eventosAnular = config.wix.webhookEvents.anular;

    // Normalizar para comparacion (lowercase, sin guiones bajos)
    const slugNorm = (slug || '').toLowerCase().replace(/_/g, '');
    const eventTypeNorm = (eventType || '').toLowerCase().replace(/_/g, '');

    // Verificar si el slug o eventType coincide con eventos configurados
    const esEventoEmitir = eventosEmitir.some(e => {
      const eNorm = e.toLowerCase().replace(/_/g, '');
      return slugNorm.includes(eNorm) || eventTypeNorm.includes(eNorm);
    });
    const esEventoAnular = eventosAnular.some(e => {
      const eNorm = e.toLowerCase().replace(/_/g, '');
      return slugNorm.includes(eNorm) || eventTypeNorm.includes(eNorm);
    });

    if (esEventoEmitir) {
      // Orden aprobada -> Emitir CFE
      await procesarOrdenWix(orderId, data?.order || payload);
    } else if (esEventoAnular) {
      // Cancelacion o refund -> Emitir NC
      await procesarCancelacionWix(orderId, slug, data?.order || payload);
    } else {
      logger.debug('Evento Wix ignorado', { slug, eventType });
    }

    webhookQueue.complete(queueId);
    webhookDedupe.complete(dedupeKey, eventId);
    metrics.webhooksProcesados++;
    prometheusMetrics.inc('webhooks_processed_total');
    endTimer();

  } catch (error) {
    logger.error('Error procesando webhook Wix', { error: error.message });
    metrics.errores++;
    prometheusMetrics.inc('webhooks_failed_total');
    endTimer();

    errorStore.addError(
      ERROR_TYPES.WEBHOOK,
      SEVERITY_LEVELS.HIGH,
      'webhooks/wix',
      error.message,
      { rawBody: jwtToken?.substring(0, 100) }
    );
  }
});

// ============================================================
// PROCESAMIENTO DE ORDENES WIX
// ============================================================

async function procesarOrdenWix(orderId, orderData) {
  logger.info('Procesando orden Wix', { orderId });

  try {
    // 1. Obtener orden completa si no viene en el webhook
    let order = orderData;
    if (!order || !order.lineItems) {
      order = await wixClient.getOrder(orderId);
    }

    // FIX: Validar que la orden exista y tenga datos mínimos
    if (!order) {
      logger.warn('Orden Wix no encontrada', { orderId });
      return;
    }

    if (!order.id) {
      logger.warn('Orden Wix sin ID válido', { orderId, orderKeys: Object.keys(order || {}) });
      return;
    }

    // 2. Normalizar orden
    const ordenNormalizada = wixClient.normalizeOrder(order);

    // FIX: Validar que la normalización fue exitosa
    if (!ordenNormalizada || !ordenNormalizada.id) {
      logger.error('Error normalizando orden Wix', { orderId });
      return;
    }

    // 3. Verificar estado
    if (ordenNormalizada.status === 'CANCELED') {
      logger.info('Orden cancelada, procesando como NC', { orderId });
      return await procesarCancelacionWix(orderId, 'canceled', order);
    }

    // Solo procesar ordenes aprobadas/pagadas
    if (ordenNormalizada.status !== 'APPROVED' && ordenNormalizada.paymentStatus !== 'PAID') {
      logger.debug('Orden no aprobada/pagada', { orderId, status: ordenNormalizada.status });
      return;
    }

    // 4. Verificar idempotencia (store local)
    const existente = comprobanteStore.findByOrderId(orderId);
    if (existente) {
      logger.info('Orden ya facturada (store local)', { orderId });
      return;
    }

    // 5. Verificar idempotencia (Biller)
    const numeroInterno = `WIX-${orderId}`;
    const existenteEnBiller = await biller.buscarPorNumeroInterno(numeroInterno);
    if (existenteEnBiller) {
      logger.info('Orden ya facturada (Biller)', { orderId, billerId: existenteEnBiller.id });
      comprobanteStore.set(orderId, {
        ...existenteEnBiller,
        wix_order_id: orderId,
        synced_from_biller: true
      });
      return;
    }

    // 6. Determinar tipo de comprobante
    const decision = determinarTipoComprobante(ordenNormalizada);

    // 7. Preparar datos para Biller
    const datosComprobante = prepararDatosBiller(ordenNormalizada, decision);

    // 8. Emitir comprobante
    const endBillerTimer = prometheusMetrics.startTimer('biller_request_duration_seconds');
    const comprobante = await billerCircuit.fire(async () => {
      prometheusMetrics.inc('biller_requests_total', { method: 'POST', status: 'attempt' });
      const result = await biller.emitirComprobante(datosComprobante);
      prometheusMetrics.inc('biller_requests_total', { method: 'POST', status: 'success' });
      return result;
    });
    endBillerTimer();

    // 9. Guardar en store
    comprobanteStore.set(orderId, {
      ...comprobante,
      wix_order_id: orderId,
      tipo_decision: decision.razon,
      cliente_identificado: decision.cliente !== config.CLIENTE_SIN_RECEPTOR,
      cliente: decision.cliente || null,
      total: ordenNormalizada.montos.total,
      monto_total: ordenNormalizada.montos.total
    });

    metrics.comprobantesEmitidos++;

    logger.info('Comprobante emitido', {
      orderId,
      serie: comprobante.serie,
      numero: comprobante.numero,
      tipo: decision.tipo,
      razon: decision.razon
    });

  } catch (error) {
    logger.error('Error procesando orden Wix', {
      orderId,
      error: error.message,
      response: error.response,
      code: error.code
    });

    errorStore.addError(
      ERROR_TYPES.BILLER,
      SEVERITY_LEVELS.HIGH,
      'procesarOrdenWix',
      error.message,
      { orderId, billerResponse: error.response }
    );

    throw error;
  }
}

// ============================================================
// PROCESAMIENTO DE CANCELACIONES/REFUNDS
// ============================================================

async function procesarCancelacionWix(orderId, eventSlug, orderData) {
  logger.info('Procesando cancelacion/refund Wix', { orderId, eventSlug });

  try {
    // 1. Obtener orden completa si no viene en el webhook
    let order = orderData;
    if (!order || !order.lineItems) {
      order = await wixClient.getOrder(orderId);
    }

    if (!order) {
      logger.warn('Orden Wix no encontrada para NC', { orderId });
      return;
    }

    // 2. Normalizar orden
    const ordenNormalizada = wixClient.normalizeOrder(order);

    // 3. Verificar si debe emitir NC
    if (!debeEmitirNC(eventSlug, ordenNormalizada)) {
      logger.debug('No se requiere NC para este evento', { orderId, eventSlug });
      return;
    }

    // 4. Procesar segun tipo
    let resultado;
    if (eventSlug === 'transactionsUpdated') {
      resultado = await procesarRefund(ordenNormalizada);
    } else {
      resultado = await procesarCancelacion(ordenNormalizada);
    }

    if (resultado.action === 'nc_emitted') {
      metrics.ncEmitidas++;
      logger.info('NC emitida por Wix', { orderId, ncId: resultado.nc?.id });
    } else {
      logger.info('No se emitio NC', { orderId, action: resultado.action, reason: resultado.reason });
    }

  } catch (error) {
    logger.error('Error procesando cancelacion Wix', { orderId, error: error.message });

    errorStore.addError(
      ERROR_TYPES.BILLER,
      SEVERITY_LEVELS.HIGH,
      'procesarCancelacionWix',
      error.message,
      { orderId, eventSlug }
    );

    throw error;
  }
}

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================

function prepararDatosBiller(ordenNormalizada, decision) {
  // FIX: Mapear items con helpers para evitar NaN y truncar correctamente
  const items = ordenNormalizada.items.map(item => ({
    concepto: truncateForBiller(item.nombre || 'Producto', BILLER_FIELD_LIMITS.CONCEPTO),
    cantidad: parseInt(item.cantidad) || 1,
    precio: parseMontoSeguro(item.precioUnitario, 0),
    indicador_facturacion: config.INDICADORES_IVA.GRAVADO_BASICA
  }));

  // FIX: Usar helper centralizado para fecha
  const fechaEmision = formatDateForBiller();

  const datos = {
    tipo_comprobante: decision.tipo,
    numero_interno: truncateForBiller(`WIX-${ordenNormalizada.id}`, BILLER_FIELD_LIMITS.NUMERO_INTERNO),
    sucursal: config.biller.empresa.sucursal,
    fecha_emision: fechaEmision,
    items: items,
    forma_pago: config.FORMAS_PAGO.TARJETA,
    moneda: ordenNormalizada.montos?.moneda || 'UYU',
    montos_brutos: 1  // Precios con IVA incluido
  };

  // FIX: Cliente con campos truncados según límites Biller
  if (decision.cliente && decision.cliente !== config.CLIENTE_SIN_RECEPTOR) {
    const cliente = { ...decision.cliente };
    if (cliente.razon_social) {
      cliente.razon_social = truncateForBiller(cliente.razon_social, BILLER_FIELD_LIMITS.RAZON_SOCIAL);
    }
    if (cliente.nombre_fantasia) {
      cliente.nombre_fantasia = truncateForBiller(cliente.nombre_fantasia, BILLER_FIELD_LIMITS.NOMBRE_FANTASIA);
    }
    if (cliente.sucursal) {
      if (cliente.sucursal.direccion) {
        cliente.sucursal.direccion = truncateForBiller(cliente.sucursal.direccion, BILLER_FIELD_LIMITS.DIRECCION);
      }
      if (cliente.sucursal.ciudad) {
        cliente.sucursal.ciudad = truncateForBiller(cliente.sucursal.ciudad, BILLER_FIELD_LIMITS.CIUDAD);
      }
      if (cliente.sucursal.departamento) {
        cliente.sucursal.departamento = truncateForBiller(cliente.sucursal.departamento, BILLER_FIELD_LIMITS.DEPARTAMENTO);
      }
    }
    datos.cliente = cliente;
  } else {
    datos.cliente = config.CLIENTE_SIN_RECEPTOR;
  }

  // Email de notificacion
  if (ordenNormalizada.buyer?.email) {
    datos.emails_notificacion = [ordenNormalizada.buyer.email];
  }

  return datos;
}

// ============================================================
// OAUTH WIX
// ============================================================

app.get('/auth/wix', (req, res) => {
  const params = new URLSearchParams({
    client_id: config.wix.clientId,
    redirect_uri: config.wix.redirectUri
  });

  const authUrl = `https://www.wix.com/installer/install?${params.toString()}`;
  res.redirect(authUrl);
});

app.get('/auth/wix/callback', async (req, res) => {
  const { code, error, instanceId } = req.query;

  if (error) {
    return res.status(400).send(`Error OAuth Wix: ${error}`);
  }

  if (!code) {
    return res.status(400).send('No se recibio codigo de autorizacion');
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    logger.info('OAuth Wix completado', { instanceId });

    // Guardar tokens en variables de entorno (en memoria)
    process.env.WIX_ACCESS_TOKEN = tokens.accessToken;
    process.env.WIX_REFRESH_TOKEN = tokens.refreshToken;
    process.env.WIX_TOKEN_EXPIRES_AT = new Date(Date.now() + (tokens.expiresIn * 1000)).toISOString();

    res.send(`
      <html>
      <head><title>Autorizacion exitosa</title></head>
      <body style="font-family: Arial; padding: 40px; text-align: center;">
        <h1>Autorizacion exitosa</h1>
        <p>Token expira: <strong>${new Date(Date.now() + (tokens.expiresIn * 1000)).toLocaleString()}</strong></p>
        <hr style="margin: 20px 0;">
        <div style="background: #fff3cd; padding: 15px; border-radius: 5px; text-align: left;">
          <p style="color: #856404; margin: 0 0 10px 0;"><strong>Tokens en memoria</strong></p>
          <p style="margin: 0; font-size: 14px;">Copia estos valores a tus variables de entorno:</p>
          <pre style="background: #f8f9fa; padding: 10px; font-size: 11px; overflow-x: auto;">WIX_ACCESS_TOKEN=${tokens.accessToken}
WIX_REFRESH_TOKEN=${tokens.refreshToken}
WIX_TOKEN_EXPIRES_AT=${new Date(Date.now() + (tokens.expiresIn * 1000)).toISOString()}</pre>
        </div>
        <p style="margin-top: 20px;">Ya puedes cerrar esta ventana.</p>
      </body>
      </html>
    `);

  } catch (err) {
    logger.error('Error en callback OAuth Wix', { error: err.message });
    res.status(500).send(`Error: ${err.message}`);
  }
});

// ============================================================
// API DE TOKENS WIX
// ============================================================

app.get('/api/tokens', (req, res) => {
  const expiresAt = process.env.WIX_TOKEN_EXPIRES_AT;
  const isExpired = expiresAt ? new Date(expiresAt) < new Date() : true;
  const isExpiringSoon = expiresAt ? new Date(expiresAt) < new Date(Date.now() + 30 * 60 * 1000) : true;

  res.json({
    success: true,
    tokens: {
      hasAccessToken: !!process.env.WIX_ACCESS_TOKEN,
      hasRefreshToken: !!process.env.WIX_REFRESH_TOKEN,
      expiresAt,
      isExpired,
      isExpiringSoon
    },
    hint: isExpired
      ? 'Token expirado. Re-autoriza en /auth/wix'
      : isExpiringSoon
        ? 'Token por expirar. Considera renovarlo.'
        : 'Token valido'
  });
});

app.post('/api/tokens/refresh', async (req, res) => {
  try {
    const refreshToken = process.env.WIX_REFRESH_TOKEN;
    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'No hay refresh token' });
    }

    const tokens = await refreshAccessToken(refreshToken);

    process.env.WIX_ACCESS_TOKEN = tokens.accessToken;
    process.env.WIX_REFRESH_TOKEN = tokens.refreshToken;
    process.env.WIX_TOKEN_EXPIRES_AT = new Date(Date.now() + (tokens.expiresIn * 1000)).toISOString();

    res.json({
      success: true,
      message: 'Token renovado exitosamente',
      expiresAt: process.env.WIX_TOKEN_EXPIRES_AT
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      hint: 'Si el refresh_token expiro, debes re-autorizar en /auth/wix'
    });
  }
});

// ============================================================
// API ENDPOINTS
// ============================================================

app.get('/api/comprobantes', (req, res) => {
  const comprobantes = comprobanteStore.getAll();
  res.json({
    total: comprobantes.length,
    comprobantes
  });
});

app.get('/api/comprobante/:orderId', (req, res) => {
  const comp = comprobanteStore.findByOrderId(req.params.orderId);
  if (!comp) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  res.json(comp);
});

app.get('/api/notas-credito', (req, res) => {
  const ncs = comprobanteStore.listNC();
  res.json({
    total: ncs.length,
    notasCredito: ncs
  });
});

// Reprocesar orden manualmente
app.post('/api/reprocesar-orden/:orderId', async (req, res) => {
  const { orderId } = req.params;
  logger.info('Reprocesando orden manualmente', { orderId });

  try {
    const order = await wixClient.getOrder(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Orden no encontrada en Wix'
      });
    }

    const existente = comprobanteStore.findByOrderId(orderId);
    if (existente) {
      return res.json({
        success: true,
        message: 'Orden ya facturada previamente',
        comprobante: {
          serie: existente.serie,
          numero: existente.numero,
          tipo: existente.tipo_comprobante
        }
      });
    }

    await procesarOrdenWix(orderId, order);

    const nuevoComprobante = comprobanteStore.findByOrderId(orderId);

    res.json({
      success: true,
      message: `Orden ${orderId} procesada`,
      comprobante: nuevoComprobante ? {
        serie: nuevoComprobante.serie,
        numero: nuevoComprobante.numero,
        tipo: nuevoComprobante.tipo_comprobante
      } : null
    });
  } catch (error) {
    logger.error('Error reprocesando orden', { orderId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// Forzar emision de NC
app.post('/api/emitir-nc/:orderId', async (req, res) => {
  const { orderId } = req.params;
  logger.info('Forzando emision de NC', { orderId });

  try {
    const order = await wixClient.getOrder(orderId);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Orden no encontrada en Wix' });
    }

    const ordenNormalizada = wixClient.normalizeOrder(order);
    const resultado = await procesarCancelacion(ordenNormalizada);

    if (resultado.action === 'nc_emitted') {
      metrics.ncEmitidas++;
      res.json({
        success: true,
        message: 'NC emitida exitosamente',
        nc: resultado.nc
      });
    } else {
      res.json({
        success: false,
        action: resultado.action,
        reason: resultado.reason
      });
    }
  } catch (error) {
    logger.error('Error emitiendo NC manualmente', { orderId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// Anular comprobante directamente
app.post('/api/anular-comprobante', async (req, res) => {
  const { id, tipo_comprobante, serie, numero, fecha_emision_hoy } = req.body;

  logger.info('Anulando comprobante via API', { id, tipo_comprobante, serie, numero });

  try {
    if (!id && !(tipo_comprobante && serie && numero)) {
      return res.status(400).json({
        success: false,
        error: 'Debe proporcionar id o (tipo_comprobante, serie, numero)'
      });
    }

    const params = {
      fecha_emision_hoy: fecha_emision_hoy !== false
    };

    if (id) {
      params.id = id;
    } else {
      params.tipo_comprobante = tipo_comprobante;
      params.serie = serie;
      params.numero = numero;
    }

    const nc = await biller.anularComprobante(params);
    metrics.ncEmitidas++;

    res.json({
      success: true,
      message: 'Comprobante anulado exitosamente',
      nc: {
        id: nc.id,
        tipo_comprobante: nc.tipo_comprobante,
        serie: nc.serie,
        numero: nc.numero,
        fecha_emision: nc.fecha_emision
      }
    });

  } catch (error) {
    logger.error('Error anulando comprobante', { error: error.message });
    res.status(error.status || 500).json({
      success: false,
      error: error.message,
      code: error.code
    });
  }
});

// Dashboard
app.get('/api/dashboard', (req, res) => {
  const stats = comprobanteStore.getStats();
  const errorStats = errorStore.getStats();
  const queueStats = webhookQueue.getStats();
  const circuitState = billerCircuit.getState();
  const uptimeSeconds = Math.round((Date.now() - metrics.startTime) / 1000);

  const tasaExito = metrics.webhooksRecibidos > 0
    ? ((metrics.webhooksProcesados / metrics.webhooksRecibidos) * 100).toFixed(2)
    : 100;

  const today = new Date().toISOString().split('T')[0];
  const comprobantesHoy = stats.byFecha[today] || 0;

  res.json({
    summary: {
      status: circuitState === 'open' ? 'degraded' : 'healthy',
      uptime: {
        seconds: uptimeSeconds,
        formatted: formatUptime(uptimeSeconds)
      },
      lastUpdated: new Date().toISOString()
    },
    comprobantes: {
      total: stats.total,
      hoy: comprobantesHoy,
      porTipo: {
        eTickets: stats.eTickets || 0,
        eFacturas: stats.eFacturas || 0,
        ncETickets: stats.ncETickets || 0,
        ncEFacturas: stats.ncEFacturas || 0
      },
      porFecha: stats.byFecha
    },
    webhooks: {
      recibidos: metrics.webhooksRecibidos,
      procesados: metrics.webhooksProcesados,
      fallidos: metrics.errores,
      tasaExito: parseFloat(tasaExito),
      cola: {
        pendientes: queueStats.pending || 0,
        procesando: queueStats.processing || 0,
        dead: queueStats.dead || 0
      }
    },
    errors: {
      ultimaHora: errorStats.lastHour.total,
      ultimas24h: errorStats.last24h.total,
      sinResolver: errorStats.unresolved,
      porTipo: errorStats.last24h.byType,
      porSeveridad: errorStats.last24h.bySeverity
    },
    integration: {
      biller: {
        status: circuitState,
        ambiente: config.biller.environment
      },
      wix: {
        tokenValido: !!process.env.WIX_ACCESS_TOKEN && new Date(process.env.WIX_TOKEN_EXPIRES_AT) > new Date()
      }
    },
    config: {
      limiteUI: config.dgi?.limiteMontoUYU || 30000,
      valorUI: config.dgi?.valorUI || 6.50,
      ambiente: config.biller.environment
    },
    metrics
  });
});

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// Debug: Ver orden de Wix
app.get('/api/debug/orden/:orderId', async (req, res) => {
  try {
    const order = await wixClient.getOrder(req.params.orderId);
    if (!order) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    const normalizada = wixClient.normalizeOrder(order);
    const decision = determinarTipoComprobante(normalizada);

    res.json({
      original: order,
      normalizada,
      decision
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dashboard HTML
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================

const PORT = config.server.port || 3000;

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('SERVIDOR WIX-BILLER INICIADO - v1.0');
  console.log('='.repeat(60));
  console.log(`Puerto: ${PORT}`);
  console.log(`Ambiente: ${config.biller.environment}`);
  console.log(`Limite UI: $${config.dgi?.limiteMontoUYU || 30000} UYU`);
  console.log(`Webhook: ${config.server.publicUrl}/webhooks/wix`);
  console.log('='.repeat(60) + '\n');

  logger.info('Servidor iniciado', { port: PORT, version: '1.0.0' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Recibido SIGTERM, cerrando...');
  comprobanteStore.stopAutoSave();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Recibido SIGINT, cerrando...');
  comprobanteStore.stopAutoSave();
  process.exit(0);
});

module.exports = app;
