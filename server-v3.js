/**
 * ============================================================
 * SERVIDOR PRINCIPAL - INTEGRACIÓN COMPLETA
 * MercadoLibre ↔ Biller
 * Versión 3.2 - Con métricas Prometheus, Circuit Breaker, Worker de cola
 * ============================================================
 */

require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const config = require('./config');
const { BillerClient } = require('./biller-client');
const logger = require('./utils/logger');
const { getComprobanteStore, WebhookDedupeStore } = require('./utils/store');
const { getWebhookQueue } = require('./utils/webhook-queue');
const { getTokenManager } = require('./utils/token-manager');
const { CircuitBreaker } = require('./utils/circuit-breaker-v2');
const { getMetrics } = require('./monitoring/prometheus-metrics');

// Workers
const { MLInvoiceUploaderWorker } = require('./workers/ml-invoice-uploader');
const { WebhookProcessorWorker } = require('./workers/webhook-processor');

// Servicios
const { determinarTipoComprobante, obtenerBillingInfo } = require('./services/billing-decision');
const { procesarClaim, procesarCancelacion } = require('./services/credit-note-service');
const { getReconciliationService } = require('./services/reconciliation-service');
const { getErrorStore, ERROR_TYPES, SEVERITY_LEVELS } = require('./utils/error-store');
const path = require('path');

// ============================================================
// INICIALIZACIÓN
// ============================================================

const app = express();
const biller = new BillerClient();
const comprobanteStore = getComprobanteStore();
const webhookQueue = getWebhookQueue();
const tokenManager = getTokenManager();
const prometheusMetrics = getMetrics();
const webhookDedupe = new WebhookDedupeStore(config.procesamiento?.dedupeWindow || 300000);

// Circuit Breakers
const billerCircuit = new CircuitBreaker('biller-api', {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000,
    fallback: (error) => {
        logger.error('Biller API circuit breaker activado', { error: error.message });
        throw error;
    }
});

// Inicializar workers
const mlUploader = new MLInvoiceUploaderWorker(biller);

// Inicializar ErrorStore y ReconciliationService
const errorStore = getErrorStore();
const reconciliationService = getReconciliationService(comprobanteStore, biller);

// Métricas legacy (para compatibilidad)
const metrics = {
    webhooksRecibidos: 0,
    webhooksProcesados: 0,
    comprobantesEmitidos: 0,
    ncEmitidas: 0,
    pdfSubidosML: 0,
    errores: 0,
    startTime: Date.now()
};

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        if (!req.path.startsWith('/webhooks')) {
            logger.request(req.method, req.path, res.statusCode, Date.now() - start);
        }
    });
    next();
});

// Servir archivos estáticos para el dashboard
app.use('/static', express.static(path.join(__dirname, 'public')));

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', async (req, res) => {
    try {
        const billerStatus = await biller.verificarConexion();

        res.json({
            status: 'ok',
            service: 'MercadoLibre-Biller Integration v3',
            uptime: Math.round((Date.now() - metrics.startTime) / 1000),
            biller: billerStatus,
            features: {
                regla5000UI: true,
                notasCredito: true,
                subidaFacturasML: config.mlInvoiceUpload?.enabled || false,
                circuitBreaker: true,
                prometheusMetrics: true
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
        service: 'MercadoLibre-Biller Integration',
        version: '3.2.0',
        environment: config.biller.environment,
        features: [
            'Facturación automática de ventas',
            'Regla DGI 5000 UI implementada',
            'Notas de Crédito por devoluciones',
            'Subida automática de PDFs a MercadoLibre',
            'Cola persistente de webhooks',
            'Métricas Prometheus',
            'Circuit Breaker para APIs'
        ],
        endpoints: {
            health: '/health',
            webhooks: '/webhooks/mercadolibre',
            comprobantes: '/api/comprobantes',
            notasCredito: '/api/notas-credito',
            dashboard: '/api/dashboard',
            metrics: '/metrics'
        }
    });
});

// Endpoint de métricas Prometheus
app.get('/metrics', (req, res) => {
    // Actualizar gauges antes de exportar
    prometheusMetrics.set('uptime_seconds', Math.floor((Date.now() - metrics.startTime) / 1000));
    prometheusMetrics.set('webhooks_queue_pending', webhookQueue.getStats().pending);
    prometheusMetrics.set('webhooks_queue_dead', webhookQueue.getStats().dead);

    res.set('Content-Type', 'text/plain');
    res.send(prometheusMetrics.export());
});

// ============================================================
// WEBHOOK MERCADOLIBRE - CON COLA PERSISTENTE
// ============================================================

app.post('/webhooks/mercadolibre', async (req, res) => {
    const { topic, resource, user_id } = req.body;
    const endTimer = prometheusMetrics.startTimer('webhook_processing_duration_seconds');

    metrics.webhooksRecibidos++;
    prometheusMetrics.inc('webhooks_received_total');
    logger.info(`📨 Webhook ML: ${topic}`, { resource, user_id });

    // 1. Encolar ANTES de responder (garantiza persistencia)
    const queueId = await webhookQueue.add({ topic, resource, user_id });

    // 2. Responder rápido
    res.status(200).send('OK');

    // 3. Procesar inmediatamente (también se re-procesa por worker si falla)
    const resourceId = resource?.split('/').pop();

    // Deduplicación
    if (!webhookDedupe.tryAcquire(`ml-${topic}`, resourceId)) {
        webhookQueue.complete(queueId);
        logger.debug('Webhook duplicado', { topic, resourceId });
        return;
    }

    try {
        switch (topic) {
            case 'orders_v2':
                await procesarOrdenMercadoLibre(resourceId);
                break;
            case 'claims':
                await procesarClaimMercadoLibre(resourceId);
                break;
            default:
                logger.debug('Webhook ignorado', { topic });
        }

        webhookQueue.complete(queueId);
        webhookDedupe.complete(`ml-${topic}`, resourceId);
        metrics.webhooksProcesados++;
        prometheusMetrics.inc('webhooks_processed_total');
        endTimer();

    } catch (error) {
        logger.error('Error procesando webhook', { topic, resourceId, error: error.message });
        webhookQueue.fail(queueId, error.message);
        metrics.errores++;
        prometheusMetrics.inc('webhooks_failed_total');
        webhookDedupe.release(`ml-${topic}`, resourceId);
        endTimer();

        // Registrar error en ErrorStore
        errorStore.addError(
            ERROR_TYPES.WEBHOOK,
            SEVERITY_LEVELS.HIGH,
            'webhooks/mercadolibre',
            error.message,
            { topic, resourceId, orderId: resourceId }
        );
    }
});

// ============================================================
// PROCESAMIENTO DE ÓRDENES
// ============================================================

async function procesarOrdenMercadoLibre(orderId) {
    logger.info(`📋 Procesando orden ML ${orderId}`);

    try {
        // 1. Obtener orden
        const order = await obtenerOrdenML(orderId);

        if (!order) {
            logger.warn('Orden no encontrada', { orderId });
            return;
        }

        // 2. Verificar si es cancelación
        if (order.status === 'cancelled') {
            const resultado = await procesarCancelacion(order);
            if (resultado.action === 'nc_emitted') {
                metrics.ncEmitidas++;
            }
            return;
        }

        // 3. Solo procesar órdenes pagadas
        if (order.status !== 'paid') {
            logger.debug('Orden no pagada', { orderId, status: order.status });
            return;
        }

        // 4. Verificar idempotencia (local)
        const existente = comprobanteStore.findByOrderId(orderId);
        if (existente) {
            logger.info('Orden ya facturada (store local)', { orderId });
            return;
        }

        // 4b. Validación DUAL: verificar también en Biller
        const numeroInterno = `ML-${orderId}`;
        const existenteEnBiller = await biller.buscarPorNumeroInterno(numeroInterno);
        if (existenteEnBiller) {
            logger.info('Orden ya facturada (Biller)', { orderId, billerId: existenteEnBiller.id });
            // Sincronizar con store local
            comprobanteStore.set(orderId, {
                ...existenteEnBiller,
                ml_order_id: orderId,
                synced_from_biller: true
            });
            return;
        }

        // 5. Obtener billing_info
        const billingInfo = await obtenerBillingInfo(orderId);

        // 6. Determinar tipo de comprobante (con regla 5000 UI)
        const decision = await determinarTipoComprobante(order, billingInfo);

        // 7. Preparar datos para Biller
        const datosComprobante = prepararDatosBiller(order, decision);

        // 8. Emitir comprobante (protegido por Circuit Breaker)
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
            ml_order_id: orderId,
            tipo_decision: decision.razon,
            cliente_identificado: !!decision.cliente,
            pdf_status: 'pending',
            pdf_attempt_count: 0
        });

        metrics.comprobantesEmitidos++;

        logger.info(`✅ Comprobante emitido: ${comprobante.serie}-${comprobante.numero}`, {
            tipo: decision.tipo,
            orderId
        });

    } catch (error) {
        logger.error('Error procesando orden', { orderId, error: error.message });

        // Registrar error en ErrorStore
        errorStore.addError(
            ERROR_TYPES.BILLER,
            SEVERITY_LEVELS.HIGH,
            'procesarOrdenMercadoLibre',
            error.message,
            { orderId }
        );

        throw error;
    }
}

// ============================================================
// PROCESAMIENTO DE CLAIMS (DEVOLUCIONES)
// ============================================================

async function procesarClaimMercadoLibre(claimId) {
    logger.info(`📋 Procesando claim ML ${claimId}`);

    try {
        // Obtener detalles del claim
        const claim = await obtenerClaimML(claimId);

        if (!claim) {
            logger.warn('Claim no encontrado', { claimId });
            return;
        }

        // Procesar con el servicio de NC
        const resultado = await procesarClaim(claim);

        if (resultado.action === 'nc_emitted') {
            metrics.ncEmitidas++;
            logger.info(`✅ NC emitida por claim ${claimId}`);
        }

    } catch (error) {
        logger.error('Error procesando claim', { claimId, error: error.message });

        // Registrar error en ErrorStore
        errorStore.addError(
            ERROR_TYPES.BILLER,
            SEVERITY_LEVELS.MEDIUM,
            'procesarClaimMercadoLibre',
            error.message,
            { claimId }
        );

        throw error;
    }
}

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================

async function obtenerOrdenML(orderId) {
    const accessToken = await tokenManager.ensureValidToken();
    const response = await fetch(
        `https://api.mercadolibre.com/orders/${orderId}`,
        {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        }
    );

    if (!response.ok) return null;
    return response.json();
}

async function obtenerClaimML(claimId) {
    const accessToken = await tokenManager.ensureValidToken();
    const response = await fetch(
        `https://api.mercadolibre.com/claims/${claimId}`,
        {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        }
    );

    if (!response.ok) return null;
    return response.json();
}

function prepararDatosBiller(order, decision) {
    const items = (order.order_items || []).map(item => ({
        concepto: (item.item?.title || 'Producto').substring(0, 80),
        cantidad: item.quantity || 1,
        precio: parseFloat(item.unit_price) || 0,
        indicador_facturacion: config.INDICADORES_IVA.GRAVADO_BASICA
    }));

    // Agregar envío
    if (order.shipping?.cost > 0) {
        items.push({
            concepto: 'Envío',
            cantidad: 1,
            precio: parseFloat(order.shipping.cost),
            indicador_facturacion: config.INDICADORES_IVA.GRAVADO_BASICA
        });
    }

    const datos = {
        tipo_comprobante: decision.tipo,
        numero_interno: `ML-${order.id}`,
        sucursal: config.biller.empresa.sucursal,
        items: items,
        forma_pago: 2, // Tarjeta
        moneda: 'UYU'
    };

    if (decision.cliente) {
        datos.cliente = decision.cliente;
    }

    if (order.buyer?.email) {
        datos.emails_notificacion = [order.buyer.email];
    }

    return datos;
}

// ============================================================
// OAUTH MERCADOLIBRE
// ============================================================

app.get('/auth/mercadolibre', (req, res) => {
    const authUrl = `https://auth.mercadolibre.com.uy/authorization?response_type=code&client_id=${config.mercadolibre.appId}&redirect_uri=${encodeURIComponent(config.mercadolibre.redirectUri)}`;
    res.redirect(authUrl);
});

app.get('/auth/mercadolibre/callback', async (req, res) => {
    const { code, error } = req.query;

    if (error) {
        return res.status(400).send(`Error OAuth: ${error}`);
    }

    if (!code) {
        return res.status(400).send('No se recibió código de autorización');
    }

    try {
        const response = await fetch('https://api.mercadolibre.com/oauth/token', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: config.mercadolibre.appId,
                client_secret: config.mercadolibre.appSecret,
                code: code,
                redirect_uri: config.mercadolibre.redirectUri
            })
        });

        const data = await response.json();

        if (data.error) {
            logger.error('Error OAuth ML', data);
            return res.status(400).json({ error: data.error, message: data.message });
        }

        // Guardar tokens
        tokenManager.updateTokens(
            data.access_token,
            data.refresh_token,
            data.expires_in,
            data.user_id
        );

        logger.info('OAuth completado', { userId: data.user_id });

        res.send(`
            <html>
            <head><title>Autorización exitosa</title></head>
            <body style="font-family: Arial; padding: 40px; text-align: center;">
                <h1>Autorización exitosa</h1>
                <p>Usuario ID: <strong>${data.user_id}</strong></p>
                <p>Token guardado correctamente.</p>
                <p>Ya puedes cerrar esta ventana.</p>
            </body>
            </html>
        `);

    } catch (err) {
        logger.error('Error en callback OAuth', { error: err.message });
        res.status(500).send(`Error: ${err.message}`);
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

app.get('/api/dashboard', (req, res) => {
    const stats = comprobanteStore.getStats();
    const errorStats = errorStore.getStats();
    const queueStats = webhookQueue.getStats();
    const circuitState = billerCircuit.getState();
    const uptimeSeconds = Math.round((Date.now() - metrics.startTime) / 1000);

    // Calcular tasa de éxito de webhooks
    const tasaExito = metrics.webhooksRecibidos > 0
        ? ((metrics.webhooksProcesados / metrics.webhooksRecibidos) * 100).toFixed(2)
        : 100;

    // Contar comprobantes de hoy
    const today = new Date().toISOString().split('T')[0];
    const comprobantesHoy = stats.byFecha[today] || 0;

    res.json({
        // Resumen general
        summary: {
            status: circuitState === 'open' ? 'degraded' : 'healthy',
            uptime: {
                seconds: uptimeSeconds,
                formatted: formatUptime(uptimeSeconds)
            },
            lastUpdated: new Date().toISOString()
        },

        // Comprobantes emitidos
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

        // Webhooks
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

        // Errores
        errors: {
            ultimaHora: errorStats.lastHour.total,
            ultimas24h: errorStats.last24h.total,
            sinResolver: errorStats.unresolved,
            porTipo: errorStats.last24h.byType,
            porSeveridad: errorStats.last24h.bySeverity
        },

        // Estado de integración
        integration: {
            biller: {
                status: circuitState,
                ambiente: config.biller.environment
            }
        },

        // Configuración
        config: {
            limiteUI: config.dgi?.limiteMontoUYU || 30000,
            valorUI: config.dgi?.valorUI || 6.50,
            ambiente: config.biller.environment,
            subidaMLHabilitada: config.mlInvoiceUpload?.enabled || false
        },

        // Métricas legacy (compatibilidad)
        metrics
    });
});

// Función auxiliar para formatear uptime
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
}

// ============================================================
// API DE ERRORES
// ============================================================

// GET /api/errors - Listar errores con filtros
app.get('/api/errors', (req, res) => {
    const { type, severity, resolved, source, desde, hasta, limit } = req.query;

    const errors = errorStore.getErrors({
        type,
        severity,
        resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined,
        source,
        desde,
        hasta,
        limit: parseInt(limit) || 100
    });

    res.json({
        total: errors.length,
        errors
    });
});

// GET /api/errors/stats - Estadísticas de errores
app.get('/api/errors/stats', (req, res) => {
    res.json(errorStore.getStats());
});

// POST /api/errors/:id/resolve - Marcar error como resuelto
app.post('/api/errors/:id/resolve', (req, res) => {
    const error = errorStore.markResolved(req.params.id, req.body.resolvedBy || 'manual');

    if (!error) {
        return res.status(404).json({ error: 'Error no encontrado' });
    }

    res.json(error);
});

// POST /api/errors/resolve-bulk - Marcar múltiples errores como resueltos
app.post('/api/errors/resolve-bulk', (req, res) => {
    const { errorIds, resolvedBy } = req.body;

    if (!Array.isArray(errorIds)) {
        return res.status(400).json({ error: 'errorIds debe ser un array' });
    }

    const count = errorStore.markMultipleResolved(errorIds, resolvedBy || 'bulk');
    res.json({ resolved: count });
});

// ============================================================
// API DE RECONCILIACIÓN
// ============================================================

// POST /api/reconciliation/run - Ejecutar reconciliación completa
app.post('/api/reconciliation/run', async (req, res) => {
    try {
        const results = await reconciliationService.runFullReconciliation();
        res.json(results);
    } catch (error) {
        errorStore.addError(
            ERROR_TYPES.RECONCILIATION,
            SEVERITY_LEVELS.HIGH,
            'reconciliation/run',
            error.message,
            {}
        );
        res.status(500).json({ error: error.message });
    }
});

// POST /api/reconciliation/quick - Reconciliación rápida (últimos N)
app.post('/api/reconciliation/quick', async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;

    try {
        const results = await reconciliationService.runQuickReconciliation(limit);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/reconciliation/status - Estado de última reconciliación
app.get('/api/reconciliation/status', (req, res) => {
    const summary = reconciliationService.getLastReconciliationSummary();

    if (!summary) {
        return res.json({
            message: 'No se ha ejecutado reconciliación aún',
            lastRun: null
        });
    }

    res.json(summary);
});

// GET /api/reconciliation/discrepancies - Listar discrepancias
app.get('/api/reconciliation/discrepancies', (req, res) => {
    const { type, status, severity } = req.query;
    const discrepancies = reconciliationService.getDiscrepancies({ type, status, severity });

    res.json({
        total: discrepancies.length,
        stats: reconciliationService.getDiscrepancyStats(),
        discrepancies
    });
});

// POST /api/reconciliation/discrepancies/:id/resolve - Resolver discrepancia
app.post('/api/reconciliation/discrepancies/:id/resolve', (req, res) => {
    const { resolution, notes } = req.body;
    const disc = reconciliationService.resolveDiscrepancy(
        req.params.id,
        resolution || 'resolved',
        notes || ''
    );

    if (!disc) {
        return res.status(404).json({ error: 'Discrepancia no encontrada' });
    }

    res.json(disc);
});

// ============================================================
// DASHBOARD WEB
// ============================================================

// GET /dashboard - Servir el dashboard HTML
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================

const PORT = config.server.port || 3000;

// Inicializar worker de procesamiento de webhooks
const webhookProcessor = new WebhookProcessorWorker({
    orders_v2: procesarOrdenMercadoLibre,
    claims: procesarClaimMercadoLibre
});

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 SERVIDOR INICIADO - v3.2');
    console.log('='.repeat(60));
    console.log(`📍 Puerto: ${PORT}`);
    console.log(`🌍 Ambiente: ${config.biller.environment}`);
    console.log(`📊 Límite UI: $${config.dgi?.limiteMontoUYU || 30000} UYU`);
    console.log(`📤 Subida ML: ${config.mlInvoiceUpload?.enabled ? 'Habilitada' : 'Deshabilitada'}`);
    console.log(`📈 Métricas: /metrics`);
    console.log(`🔌 Circuit Breaker: Activo`);
    console.log('='.repeat(60) + '\n');

    // Iniciar workers
    mlUploader.start();
    webhookProcessor.start();

    logger.info('Servidor iniciado', { port: PORT, version: '3.2.0' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('Recibido SIGTERM, cerrando...');
    mlUploader.stop();
    webhookProcessor.stop();
    comprobanteStore.stopAutoSave();
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('Recibido SIGINT, cerrando...');
    mlUploader.stop();
    webhookProcessor.stop();
    comprobanteStore.stopAutoSave();
    process.exit(0);
});

module.exports = app;
