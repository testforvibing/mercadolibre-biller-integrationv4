/**
 * Servicio para determinar tipo de comprobante y obtener datos de facturacion
 * Adaptado para ordenes de Wix
 * @module services/billing-decision
 */

const config = require('../config');
const logger = require('../utils/logger');

/**
 * Obtener limite de 5000 UI en UYU desde config
 * @returns {number}
 */
function getLimiteUIEnUYU() {
  return config.dgi?.limiteMontoUYU || 30000;
}

// Usar tipos de documento de config
const { TIPOS_DOCUMENTO, MAPEO_TIPO_DOCUMENTO_WIX } = config;

/**
 * Determinar tipo de comprobante segun datos del comprador
 * @param {Object} ordenNormalizada - Orden normalizada de Wix
 * @returns {Object} Decision con tipo, cliente y flags
 */
function determinarTipoComprobante(ordenNormalizada) {
  const { fiscal, montos, buyer, direccion } = ordenNormalizada;

  // Calcular monto neto (sin IVA)
  const montoTotal = montos.total || 0;
  const montoNeto = montoTotal / 1.22; // Excluir IVA 22%

  // Extraer tipo y numero de documento
  const tipoDocWix = fiscal.tipoDocumento;
  const documento = fiscal.documento;

  logger.debug('Analizando datos fiscales Wix', {
    orderId: ordenNormalizada.id,
    montoTotal,
    montoNeto,
    tipoDocWix,
    documento: documento ? `***${documento.slice(-4)}` : 'N/A'
  });

  // CASO A: Tiene RUT de empresa (12 digitos)
  if (tipoDocWix === 'UY_RUT' && documento?.length === 12) {
    logger.info('Cliente con RUT empresa -> e-Factura', { orderId: ordenNormalizada.id });

    return {
      tipo: config.TIPOS_CFE.E_FACTURA, // 111
      cliente: {
        documento: documento,
        tipo_documento: TIPOS_DOCUMENTO.RUT,
        razon_social: fiscal.razonSocial || fiscal.nombreCompleto || 'Cliente',
        pais: 'UY',
        sucursal: {
          direccion: direccion.linea1 || '',
          ciudad: direccion.ciudad || 'Montevideo',
          departamento: obtenerDepartamento(direccion.departamento) || 'Montevideo',
          pais: 'UY'
        }
      },
      validarConDGI: true,
      razon: 'RUT_EMPRESA'
    };
  }

  // CASO B: Monto > 5000 UI (requiere identificar receptor)
  if (montoNeto > getLimiteUIEnUYU()) {
    const tieneDocumento = documento && documento.length >= 7;

    logger.warn('Venta supera 5000 UI', {
      orderId: ordenNormalizada.id,
      montoNeto,
      limite: getLimiteUIEnUYU(),
      tieneDocumento
    });

    return {
      tipo: config.TIPOS_CFE.E_TICKET, // 101
      cliente: {
        documento: documento || null,
        tipo_documento: obtenerTipoDocumento(tipoDocWix),
        nombre_fantasia: fiscal.nombreCompleto || buyer.firstName || 'Consumidor',
        pais: 'UY',
        sucursal: {
          direccion: direccion.linea1 || '',
          ciudad: direccion.ciudad || 'Montevideo',
          pais: 'UY'
        }
      },
      requiereIdentificacion: true,
      advertencia: !tieneDocumento ? 'VENTA_GRANDE_SIN_DOCUMENTO' : null,
      razon: 'MONTO_MAYOR_5000UI'
    };
  }

  // CASO C: Tiene CI pero monto bajo
  if (tipoDocWix === 'UY_CI' && documento?.length >= 7) {
    logger.info('Cliente con CI, monto bajo -> e-Ticket con datos', { orderId: ordenNormalizada.id });

    return {
      tipo: config.TIPOS_CFE.E_TICKET, // 101
      cliente: {
        documento: documento,
        tipo_documento: TIPOS_DOCUMENTO.CI,
        nombre_fantasia: fiscal.nombreCompleto || buyer.firstName,
        pais: 'UY',
        sucursal: {
          direccion: direccion.linea1 || '',
          ciudad: direccion.ciudad || 'Montevideo',
          pais: 'UY'
        }
      },
      requiereIdentificacion: false,
      razon: 'CI_DISPONIBLE'
    };
  }

  // CASO D: Sin datos -> e-Ticket consumidor final (sin receptor)
  logger.info('Sin datos fiscales -> e-Ticket consumidor final', { orderId: ordenNormalizada.id });

  return {
    tipo: config.TIPOS_CFE.E_TICKET, // 101
    cliente: config.CLIENTE_SIN_RECEPTOR,  // "-" segun doc Biller
    requiereIdentificacion: false,
    razon: 'CONSUMIDOR_FINAL'
  };
}

/**
 * Obtener codigo de tipo de documento Biller desde tipo Wix
 * @param {string} tipoDocWix - Tipo de documento Wix (UY_RUT, UY_CI, etc)
 * @returns {number}
 */
function obtenerTipoDocumento(tipoDocWix) {
  return MAPEO_TIPO_DOCUMENTO_WIX[tipoDocWix] || TIPOS_DOCUMENTO.OTRO;
}

/**
 * Convertir subdivision de Wix a nombre de departamento
 * @param {string} subdivision - Ej: "UY-MO" para Montevideo
 * @returns {string}
 */
function obtenerDepartamento(subdivision) {
  if (!subdivision) return null;

  const mapeo = {
    'UY-AR': 'Artigas',
    'UY-CA': 'Canelones',
    'UY-CL': 'Cerro Largo',
    'UY-CO': 'Colonia',
    'UY-DU': 'Durazno',
    'UY-FS': 'Flores',
    'UY-FD': 'Florida',
    'UY-LA': 'Lavalleja',
    'UY-MA': 'Maldonado',
    'UY-MO': 'Montevideo',
    'UY-PA': 'Paysandu',
    'UY-RN': 'Rio Negro',
    'UY-RV': 'Rivera',
    'UY-RO': 'Rocha',
    'UY-SA': 'Salto',
    'UY-SJ': 'San Jose',
    'UY-SO': 'Soriano',
    'UY-TA': 'Tacuarembo',
    'UY-TT': 'Treinta y Tres'
  };

  return mapeo[subdivision] || subdivision;
}

/**
 * Verificar si un monto requiere identificacion del receptor
 * @param {number} montoTotal - Monto total con IVA
 * @returns {boolean}
 */
function requiereIdentificacion(montoTotal) {
  const montoNeto = montoTotal / 1.22;
  return montoNeto > getLimiteUIEnUYU();
}

/**
 * Obtener limite actual de UI en UYU
 * @returns {number}
 */
function getLimiteUI() {
  return getLimiteUIEnUYU();
}

/**
 * Construir nombre completo desde datos del comprador
 * @param {Object} buyer - Datos del comprador
 * @param {Object} fiscal - Datos fiscales
 * @returns {string|null}
 */
function construirNombre(buyer, fiscal) {
  if (fiscal?.razonSocial) return fiscal.razonSocial;
  if (fiscal?.nombreCompleto) return fiscal.nombreCompleto;

  const nombre = [buyer?.firstName, buyer?.lastName].filter(Boolean).join(' ').trim();
  return nombre || null;
}

module.exports = {
  determinarTipoComprobante,
  obtenerTipoDocumento,
  obtenerDepartamento,
  requiereIdentificacion,
  getLimiteUI,
  construirNombre,
  TIPOS_DOCUMENTO
};
