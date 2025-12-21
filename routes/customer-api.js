/**
 * API Routes para Customer Widget
 * Endpoints publicos para que clientes vean sus comprobantes
 * @module routes/customer-api
 */

const express = require('express');
const router = express.Router();
const { getComprobanteStore } = require('../utils/store');
const { BillerClient } = require('../biller-client');
const config = require('../config');
const logger = require('../utils/logger');

// ============================================================
// CORS MIDDLEWARE
// ============================================================

/**
 * CORS middleware para permitir requests del widget
 */
router.use((req, res, next) => {
  // Permitir cualquier origen para el widget (se puede restringir despues)
  const allowedOrigins = process.env.CUSTOMER_API_ALLOWED_ORIGINS
    ? process.env.CUSTOMER_API_ALLOWED_ORIGINS.split(',')
    : ['*'];

  const origin = req.headers.origin;

  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }

  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Wix-Member-Id');
  res.header('Access-Control-Max-Age', '86400'); // 24 horas

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

// ============================================================
// RATE LIMITING
// ============================================================

const rateLimiter = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const RATE_LIMIT_MAX = 30; // 30 requests por minuto

function checkRateLimit(identifier) {
  const now = Date.now();
  const record = rateLimiter.get(identifier);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW) {
    rateLimiter.set(identifier, { windowStart: now, count: 1 });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

// Limpiar rate limiter periodicamente
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimiter) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW) {
      rateLimiter.delete(key);
    }
  }
}, 60 * 1000).unref();

// ============================================================
// ENDPOINTS
// ============================================================

/**
 * GET /api/customer/invoices
 * Lista comprobantes de un cliente por email
 *
 * Query params:
 * - email: Email del cliente (requerido)
 *
 * El widget de Wix debe pasar el email del miembro logueado
 */
router.get('/invoices', (req, res) => {
  try {
    const { email } = req.query;
    const memberId = req.headers['x-wix-member-id'];

    // Validar que venga email
    if (!email) {
      return res.status(400).json({
        error: 'Email requerido',
        code: 'EMAIL_REQUIRED'
      });
    }

    // Validar formato de email basico
    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: 'Email invalido',
        code: 'INVALID_EMAIL'
      });
    }

    // Rate limiting por email
    if (!checkRateLimit(email.toLowerCase())) {
      return res.status(429).json({
        error: 'Demasiadas solicitudes',
        code: 'RATE_LIMITED'
      });
    }

    const store = getComprobanteStore();
    const emailLower = email.toLowerCase();

    // Buscar comprobantes donde el email coincida
    const invoices = store.find(comp => {
      // Buscar en emails de notificacion
      if (comp.emails_notificacion?.some(e => e.toLowerCase() === emailLower)) {
        return true;
      }

      // Buscar en cliente email
      if (comp.cliente_email?.toLowerCase() === emailLower) {
        return true;
      }

      // Buscar en buyer email (de la orden original)
      if (comp.buyer?.email?.toLowerCase() === emailLower) {
        return true;
      }

      return false;
    });

    // Formatear para respuesta publica (sin datos sensibles)
    const publicInvoices = invoices
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map(formatForCustomer);

    logger.debug('Customer invoices request', {
      email: maskEmail(email),
      found: publicInvoices.length
    });

    res.json({
      invoices: publicInvoices,
      total: publicInvoices.length
    });
  } catch (error) {
    logger.error('Error en customer invoices', { error: error.message });
    res.status(500).json({
      error: 'Error interno',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * GET /api/customer/invoice/:id
 * Obtiene detalle de un comprobante
 * Requiere que el email coincida para seguridad
 */
router.get('/invoice/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        error: 'Email requerido para verificacion',
        code: 'EMAIL_REQUIRED'
      });
    }

    const store = getComprobanteStore();
    let invoice = store.get(id) || store.findByOrderId(id);

    if (!invoice) {
      return res.status(404).json({
        error: 'Comprobante no encontrado',
        code: 'NOT_FOUND'
      });
    }

    // Verificar que el email coincida
    const emailLower = email.toLowerCase();
    const hasAccess =
      invoice.emails_notificacion?.some(e => e.toLowerCase() === emailLower) ||
      invoice.cliente_email?.toLowerCase() === emailLower ||
      invoice.buyer?.email?.toLowerCase() === emailLower;

    if (!hasAccess) {
      return res.status(403).json({
        error: 'No tienes acceso a este comprobante',
        code: 'FORBIDDEN'
      });
    }

    res.json(formatForCustomerDetail(invoice));
  } catch (error) {
    logger.error('Error en customer invoice detail', { error: error.message });
    res.status(500).json({
      error: 'Error interno',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * GET /api/customer/invoice/:id/pdf
 * Descarga PDF de un comprobante
 * Requiere verificacion de email
 */
router.get('/invoice/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        error: 'Email requerido para verificacion',
        code: 'EMAIL_REQUIRED'
      });
    }

    // Rate limiting para PDFs (mas estricto)
    if (!checkRateLimit(`pdf:${email.toLowerCase()}`)) {
      return res.status(429).json({
        error: 'Demasiadas solicitudes de PDF',
        code: 'RATE_LIMITED'
      });
    }

    const store = getComprobanteStore();
    let invoice = store.get(id) || store.findByOrderId(id);

    if (!invoice || !invoice.id) {
      return res.status(404).json({
        error: 'Comprobante no encontrado',
        code: 'NOT_FOUND'
      });
    }

    // Verificar acceso
    const emailLower = email.toLowerCase();
    const hasAccess =
      invoice.emails_notificacion?.some(e => e.toLowerCase() === emailLower) ||
      invoice.cliente_email?.toLowerCase() === emailLower ||
      invoice.buyer?.email?.toLowerCase() === emailLower;

    if (!hasAccess) {
      return res.status(403).json({
        error: 'No tienes acceso a este comprobante',
        code: 'FORBIDDEN'
      });
    }

    // Obtener PDF de Biller
    const biller = new BillerClient();
    const pdfBuffer = await biller.obtenerPDF(invoice.id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="comprobante-${invoice.serie}-${invoice.numero}.pdf"`
    );
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    logger.error('Error descargando PDF para customer', { error: error.message });

    if (error.status === 404 || error.code === 'PDF_NOT_READY') {
      return res.status(404).json({
        error: 'PDF no disponible aun',
        code: 'PDF_NOT_READY'
      });
    }

    res.status(500).json({
      error: 'Error obteniendo PDF',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * GET /api/customer/order/:orderId/invoices
 * Lista comprobantes de una orden especifica
 * Util cuando el cliente conoce su numero de orden
 */
router.get('/order/:orderId/invoices', (req, res) => {
  try {
    const { orderId } = req.params;
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        error: 'Email requerido para verificacion',
        code: 'EMAIL_REQUIRED'
      });
    }

    const store = getComprobanteStore();
    const emailLower = email.toLowerCase();

    // Buscar comprobante principal
    const invoice = store.findByOrderId(orderId);

    // Buscar NC asociada
    const nc = store.findNCByOrderId(orderId);

    const results = [];

    if (invoice) {
      // Verificar acceso
      const hasAccess =
        invoice.emails_notificacion?.some(e => e.toLowerCase() === emailLower) ||
        invoice.cliente_email?.toLowerCase() === emailLower ||
        invoice.buyer?.email?.toLowerCase() === emailLower;

      if (hasAccess) {
        results.push(formatForCustomer(invoice));
      }
    }

    if (nc) {
      // NC hereda acceso del comprobante original
      results.push(formatForCustomer(nc));
    }

    if (results.length === 0) {
      return res.status(404).json({
        error: 'No se encontraron comprobantes para esta orden',
        code: 'NOT_FOUND'
      });
    }

    res.json({
      invoices: results,
      orderId
    });
  } catch (error) {
    logger.error('Error en order invoices', { error: error.message });
    res.status(500).json({
      error: 'Error interno',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ============================================================
// HELPERS
// ============================================================

/**
 * Formatea comprobante para respuesta publica
 * Excluye datos sensibles
 */
function formatForCustomer(invoice) {
  return {
    id: invoice.order_id || invoice.wix_order_id,
    type: invoice.tipo_comprobante,
    typeLabel: getTipoLabel(invoice.tipo_comprobante),
    serie: invoice.serie,
    numero: invoice.numero,
    numeroCompleto: `${invoice.serie}-${invoice.numero}`,
    total: invoice.monto_total || invoice.total,
    moneda: invoice.moneda || 'UYU',
    createdAt: invoice.created_at,
    fechaEmision: invoice.fecha_emision,
    isCreditNote: invoice.is_credit_note || [102, 112].includes(invoice.tipo_comprobante),
    pdfUrl: `/api/customer/invoice/${invoice.order_id || invoice.wix_order_id}/pdf`
  };
}

/**
 * Formatea detalle completo para customer
 */
function formatForCustomerDetail(invoice) {
  return {
    ...formatForCustomer(invoice),
    items: invoice.items?.map(item => ({
      concepto: item.concepto,
      cantidad: item.cantidad,
      precio: item.precio
    })),
    empresa: {
      nombre: config.biller.empresa.nombre,
      rut: config.biller.empresa.rut
    }
  };
}

/**
 * Obtiene etiqueta legible para tipo de comprobante
 */
function getTipoLabel(tipo) {
  const labels = {
    101: 'e-Ticket',
    102: 'Nota de Credito e-Ticket',
    103: 'Nota de Debito e-Ticket',
    111: 'e-Factura',
    112: 'Nota de Credito e-Factura',
    113: 'Nota de Debito e-Factura'
  };
  return labels[tipo] || `Comprobante Fiscal ${tipo}`;
}

/**
 * Valida formato basico de email
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Enmascara email para logs
 */
function maskEmail(email) {
  const [local, domain] = email.split('@');
  const maskedLocal = local.charAt(0) + '***' + local.charAt(local.length - 1);
  return `${maskedLocal}@${domain}`;
}

module.exports = router;
