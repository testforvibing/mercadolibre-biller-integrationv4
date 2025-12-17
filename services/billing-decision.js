/**
 * Servicio para determinar tipo de comprobante y obtener datos de facturación
 * @module services/billing-decision
 */

const config = require('../config');
const logger = require('../utils/logger');

/**
 * Obtener límite de 5000 UI en UYU desde config
 * @returns {number}
 */
function getLimiteUIEnUYU() {
  return config.dgi?.limiteMontoUYU || 30000;
}

// Usar tipos de documento de config
const { TIPOS_DOCUMENTO } = config;

/**
 * Determinar tipo de comprobante según datos del comprador
 * @param {Object} orden - Orden de MercadoLibre
 * @param {Object} billingInfo - Datos de billing_info (opcional, se obtiene si no se pasa)
 * @returns {Object} Decisión con tipo, cliente y flags
 */
async function determinarTipoComprobante(orden, billingInfo = null) {
  // Obtener billing_info si no se pasó
  if (!billingInfo) {
    billingInfo = await obtenerBillingInfo(orden.id);
  }

  // Calcular monto neto (sin IVA)
  const montoTotal = parseFloat(orden.total_amount || orden.paid_amount || 0);
  const montoNeto = montoTotal / 1.22; // Excluir IVA 22%

  // Extraer tipo y número de documento
  const docType = billingInfo?.doc_type;
  const docNumber = billingInfo?.doc_number?.replace(/\D/g, '');

  logger.debug('Analizando datos fiscales', {
    orderId: orden.id,
    montoTotal,
    montoNeto,
    docType,
    docNumber: docNumber ? `***${docNumber.slice(-4)}` : 'N/A'
  });

  // CASO A: Tiene RUT de empresa (12 dígitos)
  if (docType === 'RUT' && docNumber?.length === 12) {
    logger.info('👔 Cliente con RUT empresa → e-Factura', { orderId: orden.id });

    return {
      tipo: config.TIPOS_CFE.E_FACTURA, // 111
      cliente: {
        documento: docNumber,
        tipo_documento: TIPOS_DOCUMENTO.RUT,
        razon_social: extraerCampo(billingInfo, 'BUSINESS_NAME') ||
          construirNombre(billingInfo),
        pais: 'UY',
        sucursal: {
          direccion: extraerCampo(billingInfo, 'STREET_NAME'),
          ciudad: extraerCampo(billingInfo, 'CITY_NAME') || 'Montevideo',
          departamento: extraerCampo(billingInfo, 'STATE_NAME') || 'Montevideo',
          pais: 'UY'
        }
      },
      validarConDGI: true,
      razon: 'RUT_EMPRESA'
    };
  }

  // CASO B: Monto > 5000 UI (requiere identificar receptor)
  if (montoNeto > getLimiteUIEnUYU()) {
    const tieneDocumento = docNumber && docNumber.length >= 7;

    logger.warn('💰 Venta supera 5000 UI', {
      orderId: orden.id,
      montoNeto,
      limite: getLimiteUIEnUYU(),
      tieneDocumento
    });

    return {
      tipo: config.TIPOS_CFE.E_TICKET, // 101
      cliente: {
        documento: docNumber || null,
        tipo_documento: obtenerTipoDocumento(docType),
        nombre_fantasia: construirNombre(billingInfo) ||
          orden.buyer?.nickname ||
          'Consumidor',
        pais: 'UY',
        sucursal: {
          direccion: extraerCampo(billingInfo, 'STREET_NAME') ||
            construirDireccion(orden.shipping?.receiver_address),
          ciudad: extraerCampo(billingInfo, 'CITY_NAME') ||
            orden.shipping?.receiver_address?.city?.name ||
            'Montevideo',
          pais: 'UY'
        }
      },
      requiereIdentificacion: true,
      advertencia: !tieneDocumento ? 'VENTA_GRANDE_SIN_DOCUMENTO' : null,
      razon: 'MONTO_MAYOR_5000UI'
    };
  }

  // CASO C: Tiene CI pero monto bajo
  if (docType === 'CI' && docNumber?.length >= 7) {
    logger.info('👤 Cliente con CI, monto bajo → e-Ticket con datos', { orderId: orden.id });

    return {
      tipo: config.TIPOS_CFE.E_TICKET, // 101
      cliente: {
        documento: docNumber,
        tipo_documento: TIPOS_DOCUMENTO.CI,
        nombre_fantasia: construirNombre(billingInfo),
        pais: 'UY',
        sucursal: {
          direccion: extraerCampo(billingInfo, 'STREET_NAME'),
          ciudad: extraerCampo(billingInfo, 'CITY_NAME') || 'Montevideo',
          pais: 'UY'
        }
      },
      requiereIdentificacion: false,
      razon: 'CI_DISPONIBLE'
    };
  }

  // CASO D: Sin datos → e-Ticket consumidor final (sin receptor)
  // Según doc Biller: cliente: "-" para e-Ticket sin datos de receptor
  logger.info('🛒 Sin datos fiscales → e-Ticket consumidor final', { orderId: orden.id });

  return {
    tipo: config.TIPOS_CFE.E_TICKET, // 101
    cliente: config.CLIENTE_SIN_RECEPTOR,  // "-" según doc Biller
    requiereIdentificacion: false,
    razon: 'CONSUMIDOR_FINAL'
  };
}

/**
 * Obtener billing_info desde API MercadoLibre
 * Soporta múltiples formatos de respuesta de ML
 * @param {string} orderId - ID de la orden
 * @returns {Object|null} billing_info normalizado o null
 */
async function obtenerBillingInfo(orderId) {
  try {
    // Usar TokenManager si está disponible
    let accessToken = config.mercadolibre.accessToken;
    try {
      const { getTokenManager } = require('../utils/token-manager');
      accessToken = await getTokenManager().ensureValidToken();
    } catch (e) {
      // TokenManager no disponible, usar token de config
    }

    const response = await fetch(
      `https://api.mercadolibre.com/orders/${orderId}/billing_info`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        logger.debug('billing_info no disponible (404)', { orderId });
        return null;
      }
      logger.warn('Error obteniendo billing_info', {
        orderId,
        status: response.status
      });
      return null;
    }

    const data = await response.json();

    // Normalizar respuesta (ML puede devolver diferentes estructuras)
    return normalizarBillingInfo(data);

  } catch (error) {
    logger.error('Error consultando billing_info', {
      orderId,
      error: error.message
    });
    return null;
  }
}

/**
 * Extraer campo de additional_info
 * @param {Object} billingInfo 
 * @param {string} tipo - Tipo de campo (FIRST_NAME, LAST_NAME, etc)
 */
function extraerCampo(billingInfo, tipo) {
  if (!billingInfo?.additional_info) return null;

  const campo = billingInfo.additional_info.find(i => i.type === tipo);
  return campo?.value?.trim() || null;
}

/**
 * Construir nombre completo desde billing_info
 */
function construirNombre(billingInfo) {
  if (!billingInfo) return null;

  const firstName = extraerCampo(billingInfo, 'FIRST_NAME');
  const lastName = extraerCampo(billingInfo, 'LAST_NAME');
  const businessName = extraerCampo(billingInfo, 'BUSINESS_NAME');

  if (businessName) return businessName;

  const nombre = [firstName, lastName].filter(Boolean).join(' ').trim();
  return nombre || null;
}

/**
 * Construir dirección desde receiver_address
 */
function construirDireccion(address) {
  if (!address) return null;

  const partes = [
    address.street_name,
    address.street_number
  ].filter(Boolean);

  return partes.join(' ').trim() || null;
}

/**
 * Obtener código de tipo de documento
 */
function obtenerTipoDocumento(docType) {
  const tipos = {
    'RUT': TIPOS_DOCUMENTO.RUT,
    'CI': TIPOS_DOCUMENTO.CI,
    'DNI': TIPOS_DOCUMENTO.CI,
    'PASSPORT': TIPOS_DOCUMENTO.PASAPORTE
  };

  return tipos[docType] || TIPOS_DOCUMENTO.OTRO;
}

/**
 * Verificar si un monto requiere identificación del receptor
 * @param {number} montoTotal - Monto total con IVA
 * @returns {boolean}
 */
function requiereIdentificacion(montoTotal) {
  const montoNeto = montoTotal / 1.22;
  return montoNeto > getLimiteUIEnUYU();
}

/**
 * Obtener límite actual de UI en UYU
 * @returns {number}
 */
function getLimiteUI() {
  return getLimiteUIEnUYU();
}

/**
 * Normalizar respuesta de billing_info de MercadoLibre
 * ML puede devolver diferentes estructuras según el endpoint
 * @param {Object} data - Respuesta cruda de ML
 * @returns {Object|null} billing_info normalizado
 */
function normalizarBillingInfo(data) {
  if (!data) return null;

  // Estructura 1: { billing_info: { doc_type, doc_number, additional_info } }
  if (data.billing_info) {
    const bi = data.billing_info;
    return {
      doc_type: bi.doc_type,
      doc_number: bi.doc_number,
      additional_info: bi.additional_info || []
    };
  }

  // Estructura 2: { doc_type, doc_number } directamente
  if (data.doc_type) {
    return {
      doc_type: data.doc_type,
      doc_number: data.doc_number,
      additional_info: data.additional_info || []
    };
  }

  // Estructura 3: Solo additional_info
  if (data.additional_info && Array.isArray(data.additional_info)) {
    const docType = data.additional_info.find(i => i.type === 'DOC_TYPE')?.value;
    const docNumber = data.additional_info.find(i => i.type === 'DOC_NUMBER')?.value;

    return {
      doc_type: docType || null,
      doc_number: docNumber || null,
      additional_info: data.additional_info
    };
  }

  // Estructura 4: Respuesta legacy de billing-info/{site}/{id}
  if (data.identification) {
    return {
      doc_type: data.identification.type,
      doc_number: data.identification.number,
      additional_info: [
        { type: 'FIRST_NAME', value: data.first_name },
        { type: 'LAST_NAME', value: data.last_name },
        { type: 'BUSINESS_NAME', value: data.business_name },
        { type: 'STREET_NAME', value: data.address?.street_name },
        { type: 'CITY_NAME', value: data.address?.city_name },
        { type: 'STATE_NAME', value: data.address?.state_name }
      ].filter(i => i.value)
    };
  }

  logger.debug('billing_info con estructura desconocida', { keys: Object.keys(data) });
  return null;
}

module.exports = {
  determinarTipoComprobante,
  obtenerBillingInfo,
  normalizarBillingInfo,
  extraerCampo,
  construirNombre,
  requiereIdentificacion,
  getLimiteUI,
  TIPOS_DOCUMENTO
};
