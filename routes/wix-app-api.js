/**
 * API Routes para Wix Dashboard App
 * Endpoints para el panel de administracion en Wix Business Manager
 * @module routes/wix-app-api
 */

const express = require('express');
const router = express.Router();
const { wixAppAuth, requireOwner } = require('../middleware/wix-app-auth');
const { getComprobanteStore } = require('../utils/store');
const { getSettingsStore } = require('../utils/wix-app-store');
const { BillerClient } = require('../biller-client');
const { getWixClient } = require('../wix-client');
const config = require('../config');
const logger = require('../utils/logger');

// Aplicar autenticacion Wix a todas las rutas
router.use(wixAppAuth);

// ============================================================
// DASHBOARD PRINCIPAL
// ============================================================

/**
 * GET /api/wix-app/dashboard
 * Obtiene resumen de estadisticas para el dashboard principal
 */
router.get('/dashboard', async (req, res) => {
  try {
    const store = getComprobanteStore();
    const stats = store.getStats();

    const today = new Date().toISOString().split('T')[0];
    const comprobantesHoy = stats.byFecha[today] || 0;

    // Obtener ultimos 10 comprobantes
    const recentInvoices = store.getAll()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10)
      .map(formatInvoiceForDashboard);

    // Verificar conexion con Biller
    let billerStatus = { connected: false, ambiente: config.biller.environment };
    try {
      const biller = new BillerClient();
      billerStatus = await biller.verificarConexion();
    } catch (e) {
      billerStatus.error = e.message;
    }

    // Calcular tasa de exito (ultimos 7 dias)
    const successRate = calculateSuccessRate(store, 7);

    res.json({
      summary: {
        total: stats.total,
        today: comprobantesHoy,
        eTickets: stats.eTickets || 0,
        eFacturas: stats.eFacturas || 0,
        ncTotal: (stats.ncETickets || 0) + (stats.ncEFacturas || 0),
        errors: 0 // Placeholder - integrar con error store
      },
      recentInvoices,
      successRate,
      billerStatus: {
        connected: billerStatus.conectado || billerStatus.connected,
        ambiente: billerStatus.ambiente || config.biller.environment,
        empresa: config.biller.empresa.nombre
      },
      config: {
        limiteUI: config.dgi.limiteMontoUYU,
        valorUI: config.dgi.valorUI,
        ambiente: config.biller.environment
      }
    });
  } catch (error) {
    logger.error('Error en dashboard API', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// LISTADO DE COMPROBANTES
// ============================================================

/**
 * GET /api/wix-app/invoices
 * Lista comprobantes con paginacion y filtros
 */
router.get('/invoices', (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      type,
      from,
      to,
      search,
      sort = 'desc'
    } = req.query;

    const store = getComprobanteStore();
    let invoices = store.getAll();

    // Aplicar filtros
    if (type && type !== 'all') {
      const tipoNum = parseInt(type);
      invoices = invoices.filter(i => i.tipo_comprobante === tipoNum);
    }

    if (from) {
      invoices = invoices.filter(i => i.created_at >= from);
    }

    if (to) {
      // Agregar tiempo al final del dia
      const toDate = to + 'T23:59:59.999Z';
      invoices = invoices.filter(i => i.created_at <= toDate);
    }

    if (search) {
      const s = search.toLowerCase();
      invoices = invoices.filter(i =>
        i.order_id?.toLowerCase().includes(s) ||
        i.wix_order_id?.toLowerCase().includes(s) ||
        i.cliente?.razon_social?.toLowerCase().includes(s) ||
        `${i.serie}-${i.numero}`.toLowerCase().includes(s) ||
        i.numero_interno?.toLowerCase().includes(s)
      );
    }

    // Ordenar
    invoices.sort((a, b) => {
      const dateA = new Date(a.created_at);
      const dateB = new Date(b.created_at);
      return sort === 'asc' ? dateA - dateB : dateB - dateA;
    });

    // Paginar
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100);
    const start = (pageNum - 1) * limitNum;
    const paginatedInvoices = invoices.slice(start, start + limitNum);

    res.json({
      invoices: paginatedInvoices.map(formatInvoiceForDashboard),
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(invoices.length / limitNum),
        total: invoices.length
      }
    });
  } catch (error) {
    logger.error('Error listando invoices', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/wix-app/invoice/:id
 * Obtiene detalle de un comprobante
 */
router.get('/invoice/:id', (req, res) => {
  try {
    const { id } = req.params;
    const store = getComprobanteStore();

    // Buscar por order_id o por key
    let invoice = store.get(id) || store.findByOrderId(id);

    if (!invoice) {
      // Buscar por numero_interno
      invoice = store.find(c => c.numero_interno === id)[0];
    }

    if (!invoice) {
      return res.status(404).json({ error: 'Comprobante no encontrado' });
    }

    res.json(formatInvoiceDetail(invoice));
  } catch (error) {
    logger.error('Error obteniendo invoice', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/wix-app/invoice/:id/pdf
 * Descarga PDF de un comprobante
 */
router.get('/invoice/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const store = getComprobanteStore();

    let invoice = store.get(id) || store.findByOrderId(id);

    if (!invoice || !invoice.id) {
      return res.status(404).json({ error: 'Comprobante no encontrado' });
    }

    const biller = new BillerClient();
    const pdfBuffer = await biller.obtenerPDF(invoice.id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="comprobante-${invoice.serie}-${invoice.numero}.pdf"`
    );
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    logger.error('Error obteniendo PDF', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// NOTAS DE CREDITO
// ============================================================

/**
 * GET /api/wix-app/credit-notes
 * Lista notas de credito
 */
router.get('/credit-notes', (req, res) => {
  try {
    const store = getComprobanteStore();
    const ncs = store.listNC();

    res.json({
      total: ncs.length,
      creditNotes: ncs.map(formatInvoiceForDashboard)
    });
  } catch (error) {
    logger.error('Error listando NCs', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// SETTINGS
// ============================================================

/**
 * GET /api/wix-app/settings
 * Obtiene configuracion del sitio
 */
router.get('/settings', (req, res) => {
  try {
    const { instanceId } = req.wixApp;
    const settingsStore = getSettingsStore();
    const settings = settingsStore.get(instanceId);

    // Obtener estado de tokens Wix
    const wixTokenStatus = {
      hasAccessToken: !!process.env.WIX_ACCESS_TOKEN,
      hasRefreshToken: !!process.env.WIX_REFRESH_TOKEN,
      expiresAt: process.env.WIX_TOKEN_EXPIRES_AT,
      isExpired: process.env.WIX_TOKEN_EXPIRES_AT
        ? new Date(process.env.WIX_TOKEN_EXPIRES_AT) < new Date()
        : true
    };

    res.json({
      biller: {
        empresaId: settings?.biller?.empresaId || config.biller.empresa.id,
        empresaRut: settings?.biller?.empresaRut || config.biller.empresa.rut,
        sucursal: settings?.biller?.sucursal || config.biller.empresa.sucursal,
        ambiente: settings?.biller?.ambiente || config.biller.environment,
        hasToken: !!(settings?.biller?.token || config.biller.token),
        empresaNombre: config.biller.empresa.nombre
      },
      dgi: {
        valorUI: settings?.dgi?.valorUI || config.dgi.valorUI,
        margenSeguridad: settings?.dgi?.margenSeguridad || config.dgi.margenSeguridad,
        limiteUI: config.dgi.limiteUI,
        limiteMontoUYU: config.dgi.limiteMontoUYU
      },
      wix: {
        ...wixTokenStatus,
        webhookUrl: `${config.server.publicUrl}/webhooks/wix`,
        siteId: config.wix.siteId
      },
      notifications: {
        enviarAlCliente: config.facturacion.enviarAlCliente
      }
    });
  } catch (error) {
    logger.error('Error obteniendo settings', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/wix-app/settings
 * Actualiza configuracion del sitio
 * Requiere permisos de OWNER
 */
router.put('/settings', requireOwner, (req, res) => {
  try {
    const { instanceId } = req.wixApp;
    const { biller, dgi, notifications } = req.body;
    const settingsStore = getSettingsStore();

    // Validar datos de Biller si se proporcionan
    if (biller) {
      if (biller.empresaRut && !/^\d{12}$/.test(biller.empresaRut)) {
        return res.status(400).json({
          error: 'RUT de empresa debe tener 12 digitos'
        });
      }
    }

    // Actualizar settings
    const updatedSettings = settingsStore.update(instanceId, {
      biller: biller || {},
      dgi: dgi || {},
      notifications: notifications || {}
    });

    logger.info('Settings actualizados', { instanceId });

    res.json({
      success: true,
      message: 'Configuracion guardada',
      settings: updatedSettings
    });
  } catch (error) {
    logger.error('Error guardando settings', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/wix-app/settings/test-connection
 * Prueba conexion con Biller y Wix
 */
router.post('/settings/test-connection', async (req, res) => {
  try {
    const results = {
      biller: { connected: false },
      wix: { connected: false }
    };

    // Test Biller
    try {
      const biller = new BillerClient();
      const billerStatus = await biller.verificarConexion();
      results.biller = {
        connected: billerStatus.conectado || billerStatus.connected,
        ambiente: billerStatus.ambiente,
        empresa: billerStatus.empresa
      };
    } catch (e) {
      results.biller.error = e.message;
    }

    // Test Wix
    try {
      const wixClient = getWixClient();
      const wixStatus = await wixClient.verificarConexion();
      results.wix = {
        connected: wixStatus.conectado,
        siteId: wixStatus.siteId
      };
    } catch (e) {
      results.wix.error = e.message;
    }

    res.json({
      success: results.biller.connected && results.wix.connected,
      ...results
    });
  } catch (error) {
    logger.error('Error testing connection', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// OPERACIONES
// ============================================================

/**
 * POST /api/wix-app/reprocess/:orderId
 * Reprocesa una orden manualmente
 */
router.post('/reprocess/:orderId', requireOwner, async (req, res) => {
  try {
    const { orderId } = req.params;

    // Este endpoint delega al endpoint existente
    // En produccion, implementar logica aqui o reutilizar
    logger.info('Reprocesando orden via Wix App', { orderId });

    const wixClient = getWixClient();
    const order = await wixClient.getOrder(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Orden no encontrada en Wix'
      });
    }

    // Verificar si ya existe
    const store = getComprobanteStore();
    const existente = store.findByOrderId(orderId);

    if (existente) {
      return res.json({
        success: true,
        message: 'Orden ya facturada previamente',
        comprobante: formatInvoiceForDashboard(existente)
      });
    }

    // TODO: Llamar a procesarOrdenWix cuando se modularice
    // Por ahora, retornar que se debe usar el endpoint principal
    res.json({
      success: false,
      message: 'Use POST /api/reprocesar-orden/:orderId para reprocesar',
      hint: 'El reprocesamiento via Wix App estara disponible en proxima version'
    });
  } catch (error) {
    logger.error('Error reprocesando orden via Wix App', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/wix-app/refresh-tokens
 * Renueva tokens de Wix
 */
router.post('/refresh-tokens', requireOwner, async (req, res) => {
  try {
    const { refreshAccessToken } = require('../wix-client');
    const refreshToken = process.env.WIX_REFRESH_TOKEN;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'No hay refresh token configurado'
      });
    }

    const tokens = await refreshAccessToken(refreshToken);

    process.env.WIX_ACCESS_TOKEN = tokens.accessToken;
    process.env.WIX_REFRESH_TOKEN = tokens.refreshToken;
    process.env.WIX_TOKEN_EXPIRES_AT = new Date(Date.now() + (tokens.expiresIn * 1000)).toISOString();

    res.json({
      success: true,
      message: 'Tokens renovados exitosamente',
      expiresAt: process.env.WIX_TOKEN_EXPIRES_AT
    });
  } catch (error) {
    logger.error('Error renovando tokens', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
      hint: 'Si el refresh token expiro, re-autoriza en /auth/wix'
    });
  }
});

// ============================================================
// EXPORT CSV
// ============================================================

/**
 * GET /api/wix-app/export/csv
 * Exporta comprobantes a CSV
 */
router.get('/export/csv', (req, res) => {
  try {
    const { from, to, type } = req.query;
    const store = getComprobanteStore();
    let invoices = store.getAll();

    // Aplicar filtros
    if (type && type !== 'all') {
      invoices = invoices.filter(i => i.tipo_comprobante === parseInt(type));
    }
    if (from) {
      invoices = invoices.filter(i => i.created_at >= from);
    }
    if (to) {
      invoices = invoices.filter(i => i.created_at <= to + 'T23:59:59.999Z');
    }

    // Generar CSV
    const headers = [
      'Fecha',
      'Tipo',
      'Serie',
      'Numero',
      'Order ID',
      'Cliente',
      'RUT/CI',
      'Total',
      'Estado'
    ];

    const rows = invoices.map(i => [
      i.created_at?.split('T')[0] || '',
      getTipoLabel(i.tipo_comprobante),
      i.serie || '',
      i.numero || '',
      i.order_id || i.wix_order_id || '',
      i.cliente?.razon_social || 'Consumidor Final',
      i.cliente?.documento || '',
      i.monto_total || i.total || '',
      'Emitido'
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell =>
        `"${String(cell).replace(/"/g, '""')}"`
      ).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="comprobantes-${new Date().toISOString().split('T')[0]}.csv"`
    );
    res.send('\uFEFF' + csv); // BOM para Excel
  } catch (error) {
    logger.error('Error exportando CSV', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// HELPERS
// ============================================================

/**
 * Formatea un comprobante para mostrar en el dashboard
 */
function formatInvoiceForDashboard(invoice) {
  return {
    id: invoice.id,
    orderId: invoice.order_id || invoice.wix_order_id,
    type: invoice.tipo_comprobante,
    typeLabel: getTipoLabel(invoice.tipo_comprobante),
    serie: invoice.serie,
    numero: invoice.numero,
    numeroCompleto: `${invoice.serie}-${invoice.numero}`,
    customer: invoice.cliente?.razon_social || 'Consumidor Final',
    customerDoc: invoice.cliente?.documento || null,
    total: invoice.monto_total || invoice.total,
    createdAt: invoice.created_at,
    status: 'emitted',
    isCreditNote: invoice.is_credit_note || [102, 112].includes(invoice.tipo_comprobante)
  };
}

/**
 * Formatea detalle completo de comprobante
 */
function formatInvoiceDetail(invoice) {
  return {
    ...formatInvoiceForDashboard(invoice),
    numeroInterno: invoice.numero_interno,
    fechaEmision: invoice.fecha_emision,
    cliente: invoice.cliente,
    items: invoice.items,
    moneda: invoice.moneda,
    formaPago: invoice.forma_pago,
    tipoDecision: invoice.tipo_decision,
    emailsNotificacion: invoice.emails_notificacion,
    pdfUrl: invoice.id ? `/api/wix-app/invoice/${invoice.order_id}/pdf` : null,
    raw: invoice
  };
}

/**
 * Obtiene etiqueta legible para tipo de comprobante
 */
function getTipoLabel(tipo) {
  const labels = {
    101: 'e-Ticket',
    102: 'NC e-Ticket',
    103: 'ND e-Ticket',
    111: 'e-Factura',
    112: 'NC e-Factura',
    113: 'ND e-Factura'
  };
  return labels[tipo] || `CFE ${tipo}`;
}

/**
 * Calcula tasa de exito en los ultimos N dias
 */
function calculateSuccessRate(store, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();

  const recentInvoices = store.getAll().filter(i => i.created_at >= cutoffStr);

  // Por ahora asumimos que todos los guardados son exitosos
  // TODO: Integrar con error store para calculo real
  const total = recentInvoices.length;
  const successful = total; // Placeholder

  return {
    rate: total > 0 ? (successful / total * 100).toFixed(1) : 100,
    total,
    successful,
    failed: total - successful,
    period: `${days}d`
  };
}

module.exports = router;
