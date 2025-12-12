/**
 * Servicio para manejo de Notas de Crédito
 * Procesa devoluciones y refunds de MercadoLibre
 * @module services/credit-note-service
 */

const config = require('../config');
const logger = require('../utils/logger');
const { BillerClient } = require('../biller-client');
const { getComprobanteStore } = require('../utils/store');

const billerClient = new BillerClient();

// Función helper para obtener el store
function getStore() {
    return getComprobanteStore();
}

/**
 * Procesar un claim de MercadoLibre y emitir NC si corresponde
 * @param {Object} claim - Datos del claim
 * @returns {Object} Resultado del procesamiento
 */
async function procesarClaim(claim) {
    const claimId = claim.id;
    logger.info('📋 Procesando claim', { claimId, status: claim.status });

    // 1. Verificar si corresponde emitir NC
    if (!debeEmitirNC(claim)) {
        logger.info('Claim no requiere NC', { claimId, status: claim.status });
        return { action: 'skipped', reason: 'no_refund' };
    }

    // 2. Obtener orden relacionada
    const orderId = claim.resource_id || claim.order_id;
    if (!orderId) {
        logger.error('Claim sin order_id', { claimId });
        return { action: 'error', reason: 'no_order_id' };
    }

    // 3. Buscar comprobante original
    const store = getStore();
    const comprobanteOriginal = store.findByOrderId(orderId);
    if (!comprobanteOriginal) {
        logger.warn('⚠️ Claim sin comprobante original', { claimId, orderId });
        return { action: 'error', reason: 'no_original_invoice' };
    }

    // 4. Verificar que no exista NC previa
    const ncExistente = store.findNCByOrderId(orderId);
    if (ncExistente) {
        logger.info('NC ya existe para esta orden', { orderId, ncId: ncExistente.id });
        return { action: 'skipped', reason: 'nc_already_exists' };
    }

    // 5. Determinar monto de NC
    const montoNC = calcularMontoNC(claim, comprobanteOriginal);

    // 6. Emitir NC
    const nc = await emitirNotaCredito(claim, comprobanteOriginal, montoNC);

    // 7. Guardar en store
    store.addNC(orderId, nc);

    logger.info('✅ NC emitida exitosamente', {
        claimId,
        orderId,
        ncId: nc.id,
        monto: montoNC
    });

    return { action: 'nc_emitted', nc };
}

/**
 * Determinar si un claim requiere emisión de NC
 * @param {Object} claim 
 * @returns {boolean}
 */
function debeEmitirNC(claim) {
    // NC solo si el claim está cerrado con refund
    if (claim.status !== 'closed') {
        return false;
    }

    const resolution = claim.resolution?.status || claim.resolution_status;

    // Tipos de resolución que requieren NC
    const resolucionesConNC = [
        'refunded',
        'partial_refunded',
        'refund',
        'partial_refund'
    ];

    return resolucionesConNC.includes(resolution);
}

/**
 * Calcular monto de la NC
 * @param {Object} claim 
 * @param {Object} comprobanteOriginal 
 * @returns {number}
 */
function calcularMontoNC(claim, comprobanteOriginal) {
    // Si hay monto de refund específico, usarlo
    if (claim.refund_amount && claim.refund_amount > 0) {
        return parseFloat(claim.refund_amount);
    }

    // Si es refund completo, usar total del comprobante original
    if (claim.resolution?.status === 'refunded') {
        return comprobanteOriginal.total || comprobanteOriginal.monto_total;
    }

    // Caso: refund parcial sin monto específico - calcular de items
    if (claim.refund_items && claim.refund_items.length > 0) {
        return claim.refund_items.reduce((sum, item) => {
            return sum + (item.unit_price * item.quantity);
        }, 0);
    }

    // Fallback: total del comprobante
    return comprobanteOriginal.total || comprobanteOriginal.monto_total;
}

/**
 * Emitir Nota de Crédito en Biller
 * @param {Object} claim 
 * @param {Object} comprobanteOriginal 
 * @param {number} monto 
 * @returns {Object} NC emitida
 */
async function emitirNotaCredito(claim, comprobanteOriginal, monto) {
    // Determinar tipo de NC según comprobante original
    const tipoNC = obtenerTipoNC(comprobanteOriginal.tipo_comprobante);

    // Preparar items para NC
    const items = prepararItemsNC(claim, comprobanteOriginal, monto);

    // Preparar referencia al comprobante original
    const referencias = [{
        tipo: comprobanteOriginal.tipo_comprobante,
        serie: comprobanteOriginal.serie,
        numero: comprobanteOriginal.numero,
        fecha: comprobanteOriginal.fecha_emision?.split('T')[0] ||
            new Date().toISOString().split('T')[0]
    }];

    // Construir datos de NC
    const datosNC = {
        tipo_comprobante: tipoNC,
        numero_interno: `NC-ML-${claim.resource_id || claim.order_id}-${Date.now()}`,
        sucursal: config.biller.empresa.sucursal,
        items: items,
        referencias: referencias,
        razon: construirRazonNC(claim),
        forma_pago: config.FORMAS_PAGO.OTRO,
        moneda: 'UYU'
    };

    // Incluir datos del cliente si el original los tenía
    if (comprobanteOriginal.cliente) {
        datosNC.cliente = comprobanteOriginal.cliente;
    }

    logger.info('Emitiendo NC', {
        tipo: tipoNC,
        monto,
        referenciaOriginal: `${comprobanteOriginal.serie}-${comprobanteOriginal.numero}`
    });

    // Emitir en Biller
    return await billerClient.emitirComprobante(datosNC);
}

/**
 * Obtener tipo de NC según comprobante original
 * @param {number} tipoOriginal 
 * @returns {number}
 */
function obtenerTipoNC(tipoOriginal) {
    // e-Ticket (101) → NC e-Ticket (102)
    // e-Factura (111) → NC e-Factura (112)
    const mapeo = {
        101: 102,  // e-Ticket → NC e-Ticket
        111: 112,  // e-Factura → NC e-Factura
        121: 122,  // e-Ticket Contingencia → NC
        131: 132   // e-Factura Contingencia → NC
    };

    return mapeo[tipoOriginal] || 102; // Default: NC e-Ticket
}

/**
 * Preparar items para NC
 * @param {Object} claim 
 * @param {Object} comprobanteOriginal 
 * @param {number} monto 
 * @returns {Array}
 */
function prepararItemsNC(claim, comprobanteOriginal, monto) {
    // Si hay items específicos del refund
    if (claim.refund_items && claim.refund_items.length > 0) {
        return claim.refund_items.map(item => ({
            concepto: `Devolución: ${item.title || 'Producto'}`,
            cantidad: item.quantity,
            precio: parseFloat(item.unit_price),
            indicador_facturacion: config.INDICADORES_IVA.GRAVADO_BASICA
        }));
    }

    // NC genérica por el monto total
    return [{
        concepto: `Devolución Orden ML ${claim.resource_id || claim.order_id}`,
        cantidad: 1,
        precio: monto,
        indicador_facturacion: config.INDICADORES_IVA.GRAVADO_BASICA
    }];
}

/**
 * Construir razón de la NC
 * @param {Object} claim 
 * @returns {string}
 */
function construirRazonNC(claim) {
    const partes = ['Devolución'];

    if (claim.id) {
        partes.push(`Claim ${claim.id}`);
    }

    if (claim.reason_id) {
        partes.push(`Motivo: ${claim.reason_id}`);
    }

    if (claim.resource_id) {
        partes.push(`Orden: ${claim.resource_id}`);
    }

    return partes.join(' - ').substring(0, 200);
}

/**
 * Procesar cancelación de orden
 * Emite NC si la orden ya estaba facturada
 * @param {Object} orden - Orden cancelada
 * @returns {Object} Resultado
 */
async function procesarCancelacion(orden) {
    if (orden.status !== 'cancelled') {
        return { action: 'skipped', reason: 'not_cancelled' };
    }

    const orderId = orden.id;
    logger.info('🚫 Procesando cancelación', { orderId });

    // Buscar comprobante original
    const store = getStore();
    const comprobante = store.findByOrderId(orderId);
    if (!comprobante) {
        logger.info('Cancelación sin comprobante previo', { orderId });
        return { action: 'skipped', reason: 'no_invoice' };
    }

    // Verificar NC existente
    const ncExistente = store.findNCByOrderId(orderId);
    if (ncExistente) {
        logger.info('NC ya existe para cancelación', { orderId });
        return { action: 'skipped', reason: 'nc_exists' };
    }

    // Crear claim simulado para usar la misma lógica
    const claimSimulado = {
        id: `CANCEL-${orderId}`,
        status: 'closed',
        resolution: { status: 'refunded' },
        resource_id: orderId,
        reason_id: 'Cancelación de orden'
    };

    // Emitir NC
    const monto = comprobante.total || comprobante.monto_total;
    const nc = await emitirNotaCredito(claimSimulado, comprobante, monto);

    store.addNC(orderId, nc);

    logger.info('✅ NC emitida por cancelación', { orderId, ncId: nc.id });

    return { action: 'nc_emitted', nc };
}

module.exports = {
    procesarClaim,
    procesarCancelacion,
    debeEmitirNC,
    calcularMontoNC,
    emitirNotaCredito,
    obtenerTipoNC
};
