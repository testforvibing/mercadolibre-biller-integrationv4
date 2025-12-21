/**
 * Servicio para manejo de Notas de Credito
 * Procesa cancelaciones y refunds de Wix
 * @module services/credit-note-service
 */

const config = require('../config');
const logger = require('../utils/logger');
const { BillerClient } = require('../biller-client');
const { getComprobanteStore } = require('../utils/store');
const { parseMontoSeguro, formatDateForBiller } = require('../utils/date-formatter');

const billerClient = new BillerClient();

// Funcion helper para obtener el store
function getStore() {
  return getComprobanteStore();
}

/**
 * Calcular total de una orden normalizada de Wix
 * FIX: Usar parseMontoSeguro para evitar NaN
 * @param {Object} ordenNormalizada
 * @returns {number}
 */
function calcularTotalOrden(ordenNormalizada) {
  if (!ordenNormalizada) return 0;

  // Usar monto total si esta disponible
  const montoTotal = parseMontoSeguro(ordenNormalizada.montos?.total, 0);
  if (montoTotal > 0) {
    return montoTotal;
  }

  // Calcular desde items
  const itemsTotal = (ordenNormalizada.items || []).reduce((sum, item) => {
    return sum + parseMontoSeguro(item.precioTotal, 0);
  }, 0);

  return itemsTotal;
}

/**
 * Procesar cancelacion de orden de Wix
 * Emite NC si la orden ya estaba facturada
 * @param {Object} ordenNormalizada - Orden normalizada de Wix
 * @returns {Object} Resultado
 */
async function procesarCancelacion(ordenNormalizada) {
  const orderId = ordenNormalizada.id;
  logger.info('Procesando cancelacion Wix para NC', { orderId });

  // Buscar comprobante original en store local
  const store = getStore();
  let comprobante = store.findByOrderId(orderId);

  // Si no esta en store local, buscar en Biller
  if (!comprobante) {
    logger.info('Comprobante no en store local, buscando en Biller...', { orderId });
    const numeroInterno = `WIX-${orderId}`;
    const comprobanteEnBiller = await billerClient.buscarPorNumeroInterno(numeroInterno);

    if (comprobanteEnBiller) {
      logger.info('Comprobante encontrado en Biller', { orderId, billerId: comprobanteEnBiller.id });

      // Calcular total desde la orden
      const totalOrden = calcularTotalOrden(ordenNormalizada);

      comprobante = {
        ...comprobanteEnBiller,
        wix_order_id: orderId,
        total: totalOrden,
        monto_total: totalOrden,
        synced_from_biller: true
      };

      // Guardar en store local para futuras referencias
      store.set(orderId, comprobante);
      logger.info('Comprobante sincronizado a store local', { orderId, billerId: comprobanteEnBiller.id, total: totalOrden });
    }
  }

  if (!comprobante) {
    logger.info('Cancelacion sin comprobante previo (ni en store ni en Biller)', { orderId });
    return { action: 'skipped', reason: 'no_invoice' };
  }

  logger.info('Comprobante original encontrado', {
    orderId,
    comprobanteId: comprobante.id,
    serie: comprobante.serie,
    numero: comprobante.numero,
    total: comprobante.total || comprobante.monto_total
  });

  // Verificar NC existente en store local
  let ncExistente = store.findNCByOrderId(orderId);

  // Tambien verificar en Biller si ya existe NC
  if (!ncExistente) {
    const ncNumeroInterno = `NC-WIX-${orderId}`;
    const ncEnBiller = await billerClient.buscarPorNumeroInterno(ncNumeroInterno);

    if (ncEnBiller) {
      logger.info('NC ya existe en Biller para esta cancelacion', { orderId, ncId: ncEnBiller.id });
      store.addNC(orderId, { ...ncEnBiller, synced_from_biller: true });
      return { action: 'skipped', reason: 'nc_exists_in_biller' };
    }
  } else {
    logger.info('NC ya existe en store local', { orderId, ncId: ncExistente.id });
    return { action: 'skipped', reason: 'nc_exists' };
  }

  // Determinar monto para NC
  let monto = comprobante.total || comprobante.monto_total;

  // Si aun no tenemos monto, calcularlo de la orden
  if (!monto || monto <= 0) {
    logger.warn('Monto no disponible en comprobante, calculando de orden...', { orderId });
    monto = calcularTotalOrden(ordenNormalizada);
  }

  if (!monto || monto <= 0) {
    logger.error('No se pudo determinar el monto para la NC', {
      orderId,
      comprobanteTotal: comprobante.total,
      comprobanteMontoTotal: comprobante.monto_total
    });
    return { action: 'error', reason: 'no_amount' };
  }

  logger.info('Monto determinado para NC', { orderId, monto });

  // Usar endpoint /anular de Biller (preferible)
  logger.info('Anulando comprobante via endpoint /anular', { orderId, monto });
  const nc = await anularComprobanteBiller(comprobante, orderId);

  store.addNC(orderId, nc);

  logger.info('NC emitida exitosamente por cancelacion', {
    orderId,
    ncId: nc.id,
    ncSerie: nc.serie,
    ncNumero: nc.numero,
    monto
  });

  return { action: 'nc_emitted', nc };
}

/**
 * Procesar refund de Wix (transactionsUpdated)
 * @param {Object} ordenNormalizada - Orden normalizada
 * @param {Object} transactionData - Datos de la transaccion (opcional)
 * @returns {Object} Resultado
 */
async function procesarRefund(ordenNormalizada, transactionData = null) {
  const orderId = ordenNormalizada.id;
  logger.info('Procesando refund Wix', { orderId });

  // Verificar si el payment status es REFUNDED
  if (ordenNormalizada.paymentStatus !== 'REFUNDED') {
    logger.debug('Orden no tiene paymentStatus REFUNDED', { orderId, paymentStatus: ordenNormalizada.paymentStatus });
    return { action: 'skipped', reason: 'not_refunded' };
  }

  // Procesar como cancelacion (misma logica)
  return await procesarCancelacion(ordenNormalizada);
}

/**
 * Anular comprobante usando el endpoint /anular de Biller
 *
 * IMPORTANTE: Este metodo es PREFERIBLE a emitir NC manualmente porque:
 * - Garantiza que los totales por indicador de IVA coincidan exactamente
 * - No requiere calcular IVA ni especificar items manualmente
 * - Evita errores como "el total para el indicador X es mayor a la suma por indicador"
 *
 * @param {Object} comprobanteOriginal - Comprobante a anular
 * @param {string} orderId - ID de la orden de Wix (para logging)
 * @returns {Object} NC emitida por Biller
 */
async function anularComprobanteBiller(comprobanteOriginal, orderId) {
  logger.info('Anulando comprobante via endpoint /anular', {
    orderId,
    comprobanteId: comprobanteOriginal.id,
    serie: comprobanteOriginal.serie,
    numero: comprobanteOriginal.numero,
    tipo: comprobanteOriginal.tipo_comprobante
  });

  // Usar el endpoint de anulacion de Biller
  const params = {
    fecha_emision_hoy: true
  };

  if (comprobanteOriginal.id) {
    params.id = comprobanteOriginal.id;
  } else {
    params.tipo_comprobante = comprobanteOriginal.tipo_comprobante;
    params.serie = comprobanteOriginal.serie;
    params.numero = comprobanteOriginal.numero;
  }

  const nc = await billerClient.anularComprobante(params);

  logger.info('Comprobante anulado exitosamente via /anular', {
    orderId,
    ncId: nc.id,
    ncSerie: nc.serie,
    ncNumero: nc.numero,
    ncTipo: nc.tipo_comprobante
  });

  return nc;
}

/**
 * Emitir Nota de Credito manual en Biller
 * Para casos de NC parciales donde se necesita especificar items especificos
 *
 * @param {Object} ordenNormalizada
 * @param {Object} comprobanteOriginal
 * @param {number} monto
 * @returns {Object} NC emitida
 */
async function emitirNotaCreditoManual(ordenNormalizada, comprobanteOriginal, monto) {
  const orderId = ordenNormalizada.id;

  logger.info('Emitiendo NC manual', { orderId, monto });

  // Determinar tipo de NC segun comprobante original
  const tipoNC = obtenerTipoNC(comprobanteOriginal.tipo_comprobante);

  // Preparar items para NC
  const items = [{
    concepto: `Devolucion Orden Wix ${orderId}`,
    cantidad: 1,
    precio: monto,
    indicador_facturacion: config.INDICADORES_IVA.GRAVADO_BASICA
  }];

  // Preparar referencia al comprobante original
  const referencias = [{
    tipo: comprobanteOriginal.tipo_comprobante,
    serie: comprobanteOriginal.serie,
    numero: comprobanteOriginal.numero,
    fecha: comprobanteOriginal.fecha_emision?.split('T')[0] ||
      new Date().toISOString().split('T')[0]
  }];

  // FIX: Usar helper centralizado para formatear fecha
  const fechaEmision = formatDateForBiller();

  // Construir datos de NC
  const datosNC = {
    tipo_comprobante: tipoNC,
    numero_interno: `NC-WIX-${orderId}-${Date.now()}`,
    sucursal: config.biller.empresa.sucursal,
    fecha_emision: fechaEmision,
    items: items,
    referencias: referencias,
    razon_referencia: `Devolucion orden Wix ${orderId}`,
    forma_pago: config.FORMAS_PAGO.OTRO,
    moneda: 'UYU',
    montos_brutos: 1  // Los precios vienen con IVA incluido
  };

  // Incluir datos del cliente si el original los tenia
  if (comprobanteOriginal.cliente) {
    datosNC.cliente = comprobanteOriginal.cliente;
  }

  logger.info('Emitiendo NC manual', {
    tipo: tipoNC,
    monto,
    referenciaOriginal: `${comprobanteOriginal.serie}-${comprobanteOriginal.numero}`
  });

  // Emitir en Biller
  return await billerClient.emitirComprobante(datosNC);
}

/**
 * Obtener tipo de NC segun comprobante original
 * Basado en documentacion Biller API v2
 * @param {number} tipoOriginal
 * @returns {number}
 */
function obtenerTipoNC(tipoOriginal) {
  const mapeo = {
    // CFEs estandar
    101: 102,  // e-Ticket -> NC e-Ticket
    111: 112,  // e-Factura -> NC e-Factura
    // Exportaciones
    121: 122,  // e-Factura exportacion -> NC e-Factura exportacion
    // Venta por cuenta ajena
    131: 132,  // e-Ticket venta por cuenta ajena -> NC
    141: 142   // e-Factura venta por cuenta ajena -> NC
  };

  return mapeo[tipoOriginal] || 102; // Default: NC e-Ticket
}

/**
 * Verificar si debe emitir NC para un evento de Wix
 * @param {string} eventSlug - Slug del evento (canceled, transactions_updated, refunded, etc.)
 * @param {Object} ordenNormalizada - Orden normalizada
 * @returns {boolean}
 */
function debeEmitirNC(eventSlug, ordenNormalizada) {
  // Normalizar slug (lowercase, sin guiones bajos)
  const slugNormalizado = (eventSlug || '').toLowerCase().replace(/_/g, '');

  // Evento de cancelacion
  if (slugNormalizado.includes('cancel')) {
    return true;
  }

  // Evento de transacciones actualizadas (refund)
  // Puede venir como: transactionsUpdated, transactions_updated, transactionsupdated
  if (slugNormalizado.includes('transaction') || slugNormalizado.includes('refund')) {
    // Solo emitir NC si el estado de pago es REFUNDED
    return ordenNormalizada.paymentStatus === 'REFUNDED';
  }

  return false;
}

module.exports = {
  procesarCancelacion,
  procesarRefund,
  anularComprobanteBiller,
  emitirNotaCreditoManual,
  obtenerTipoNC,
  debeEmitirNC,
  calcularTotalOrden
};
