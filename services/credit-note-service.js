/**
 * Servicio para manejo de Notas de Crédito
 * Procesa devoluciones y refunds de MercadoLibre
 * @module services/credit-note-service
 */

const config = require('../config');
const logger = require('../utils/logger');
const { BillerClient } = require('../biller-client');
const { getComprobanteStore } = require('../utils/store');
const { getTokenManager } = require('../utils/token-manager');

const billerClient = new BillerClient();

/**
 * Obtener orden de MercadoLibre para extraer monto total
 * @param {string} orderId
 * @returns {Object|null}
 */
async function obtenerOrdenML(orderId) {
    try {
        const tokenManager = getTokenManager();
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

        if (!response.ok) {
            logger.warn('No se pudo obtener orden de ML', { orderId, status: response.status });
            return null;
        }

        return await response.json();
    } catch (error) {
        logger.error('Error obteniendo orden ML', { orderId, error: error.message });
        return null;
    }
}

/**
 * Calcular total de una orden de MercadoLibre
 * @param {Object} order
 * @returns {number}
 */
function calcularTotalOrden(order) {
    if (!order) return 0;

    // Usar total_amount si está disponible
    if (order.total_amount && order.total_amount > 0) {
        return parseFloat(order.total_amount);
    }

    // Calcular desde items + shipping
    const itemsTotal = (order.order_items || []).reduce((sum, item) => {
        return sum + (parseFloat(item.unit_price || 0) * (item.quantity || 1));
    }, 0);

    const shippingCost = order.shipping?.cost ? parseFloat(order.shipping.cost) : 0;

    return itemsTotal + shippingCost;
}

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

    // 3. Buscar comprobante original en store local
    const store = getStore();
    let comprobanteOriginal = store.findByOrderId(orderId);

    // Si no está en store local, buscar en Biller
    if (!comprobanteOriginal) {
        logger.info('Comprobante no encontrado en store local, buscando en Biller...', { orderId, claimId });
        const numeroInterno = `ML-${orderId}`;
        const comprobanteEnBiller = await billerClient.buscarPorNumeroInterno(numeroInterno);

        if (comprobanteEnBiller) {
            // Calcular total desde refund_amount si está disponible
            const totalEstimado = claim.refund_amount || 0;

            comprobanteOriginal = {
                ...comprobanteEnBiller,
                ml_order_id: orderId,
                total: totalEstimado,
                monto_total: totalEstimado,
                synced_from_biller: true
            };

            // Guardar en store local para futuras referencias
            store.set(orderId, comprobanteOriginal);
            logger.info('Comprobante encontrado en Biller y sincronizado', { orderId, billerId: comprobanteEnBiller.id });
        }
    }

    if (!comprobanteOriginal) {
        logger.warn('⚠️ Claim sin comprobante original (ni en store ni en Biller)', { claimId, orderId });
        return { action: 'error', reason: 'no_original_invoice' };
    }

    // 4. Verificar que no exista NC previa en store local
    let ncExistente = store.findNCByOrderId(orderId);

    // También verificar en Biller si ya existe NC
    if (!ncExistente) {
        const ncNumeroInterno = `NC-ML-${orderId}`;
        const ncEnBiller = await billerClient.buscarPorNumeroInterno(ncNumeroInterno);
        if (ncEnBiller) {
            logger.info('NC ya existe en Biller para este claim', { orderId, ncId: ncEnBiller.id });
            store.addNC(orderId, { ...ncEnBiller, synced_from_biller: true });
            return { action: 'skipped', reason: 'nc_exists_in_biller' };
        }
    } else {
        logger.info('NC ya existe para esta orden', { orderId, ncId: ncExistente.id });
        return { action: 'skipped', reason: 'nc_already_exists' };
    }

    // 5. Determinar monto de NC
    const montoNC = calcularMontoNC(claim, comprobanteOriginal);

    if (!montoNC || montoNC <= 0) {
        logger.error('No se pudo determinar el monto para la NC', { claimId, orderId });
        return { action: 'error', reason: 'no_amount' };
    }

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
 * Anular comprobante usando el endpoint /anular de Biller
 *
 * IMPORTANTE: Este método es PREFERIBLE a emitir NC manualmente porque:
 * - Garantiza que los totales por indicador de IVA coincidan exactamente
 * - No requiere calcular IVA ni especificar items manualmente
 * - Evita errores como "el total para el indicador X es mayor a la suma por indicador"
 *
 * @param {Object} comprobanteOriginal - Comprobante a anular
 * @param {string} orderId - ID de la orden de ML (para logging)
 * @returns {Object} NC emitida por Biller
 */
async function anularComprobanteBiller(comprobanteOriginal, orderId) {
    logger.info('🔄 Anulando comprobante via endpoint /anular', {
        orderId,
        comprobanteId: comprobanteOriginal.id,
        serie: comprobanteOriginal.serie,
        numero: comprobanteOriginal.numero,
        tipo: comprobanteOriginal.tipo_comprobante
    });

    // Usar el endpoint de anulación de Biller
    // Preferir ID si está disponible, sino usar tipo/serie/numero
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

    logger.info('✅ Comprobante anulado exitosamente via /anular', {
        orderId,
        ncId: nc.id,
        ncSerie: nc.serie,
        ncNumero: nc.numero,
        ncTipo: nc.tipo_comprobante
    });

    return nc;
}

/**
 * Emitir Nota de Crédito en Biller
 *
 * NOTA: Para anulaciones totales (cancelaciones, refunds completos),
 * se usa anularComprobanteBiller() que llama al endpoint /anular.
 * Esta función se mantiene para casos de NC parciales donde se necesita
 * especificar items específicos.
 *
 * @param {Object} claim
 * @param {Object} comprobanteOriginal
 * @param {number} monto
 * @param {boolean} [usarAnulacion=true] - Si true, usa endpoint /anular para anulación total
 * @returns {Object} NC emitida
 */
async function emitirNotaCredito(claim, comprobanteOriginal, monto, usarAnulacion = true) {
    const orderId = claim.resource_id || claim.order_id;
    const esRefundTotal = esAnulacionTotal(claim, comprobanteOriginal, monto);

    // Para anulaciones totales, usar el endpoint /anular
    // Esto evita errores de IVA y garantiza que los totales coincidan
    if (usarAnulacion && esRefundTotal && comprobanteOriginal.id) {
        logger.info('📋 Usando endpoint /anular para anulación total', { orderId, monto });
        return await anularComprobanteBiller(comprobanteOriginal, orderId);
    }

    // Para refunds parciales o cuando no se puede usar /anular,
    // emitir NC manualmente con items
    logger.info('📋 Emitiendo NC manual (refund parcial o sin ID)', { orderId, monto, esRefundTotal });

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

    // Obtener fecha de hoy en formato dd/mm/aaaa (requerido por Biller)
    const hoy = new Date();
    const fechaEmision = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;

    // Construir datos de NC
    const datosNC = {
        tipo_comprobante: tipoNC,
        numero_interno: `NC-ML-${orderId}-${Date.now()}`,
        sucursal: config.biller.empresa.sucursal,
        fecha_emision: fechaEmision,
        items: items,
        referencias: referencias,
        razon_referencia: construirRazonNC(claim),  // Razón de la referencia (requerido con referencias)
        forma_pago: config.FORMAS_PAGO.OTRO,
        moneda: 'UYU',
        montos_brutos: 1  // Los precios de ML vienen con IVA incluido
    };

    // Incluir datos del cliente si el original los tenía
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
 * Determinar si es una anulación total del comprobante
 * @param {Object} claim
 * @param {Object} comprobanteOriginal
 * @param {number} monto
 * @returns {boolean}
 */
function esAnulacionTotal(claim, comprobanteOriginal, monto) {
    // Si la resolución es 'refunded' (no partial), es anulación total
    const resolution = claim.resolution?.status || claim.resolution_status;
    if (resolution === 'refunded') {
        return true;
    }

    // Si el monto es igual al total original, es anulación total
    const totalOriginal = comprobanteOriginal.total || comprobanteOriginal.monto_total;
    if (totalOriginal && Math.abs(monto - totalOriginal) < 0.01) {
        return true;
    }

    // Si es un claim de cancelación (simulado)
    if (claim.id && claim.id.toString().startsWith('CANCEL-')) {
        return true;
    }

    return false;
}

/**
 * Obtener tipo de NC según comprobante original
 * Basado en documentación Biller API v2
 * @param {number} tipoOriginal
 * @returns {number}
 */
function obtenerTipoNC(tipoOriginal) {
    const mapeo = {
        // CFEs estándar
        101: 102,  // e-Ticket → NC e-Ticket
        111: 112,  // e-Factura → NC e-Factura
        // Exportaciones
        121: 122,  // e-Factura exportación → NC e-Factura exportación
        // Venta por cuenta ajena
        131: 132,  // e-Ticket venta por cuenta ajena → NC
        141: 142   // e-Factura venta por cuenta ajena → NC
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
 * @param {Object} orden - Orden cancelada (puede venir incompleta, solo con id y status)
 * @returns {Object} Resultado
 */
async function procesarCancelacion(orden) {
    if (orden.status !== 'cancelled') {
        return { action: 'skipped', reason: 'not_cancelled' };
    }

    const orderId = orden.id;
    logger.info('🚫 Procesando cancelación para NC', { orderId });

    // Buscar comprobante original en store local
    const store = getStore();
    let comprobante = store.findByOrderId(orderId);

    // Si no está en store local, buscar en Biller
    if (!comprobante) {
        logger.info('📍 Comprobante no en store local, buscando en Biller...', { orderId });
        const numeroInterno = `ML-${orderId}`;
        const comprobanteEnBiller = await billerClient.buscarPorNumeroInterno(numeroInterno);

        if (comprobanteEnBiller) {
            logger.info('✅ Comprobante encontrado en Biller', { orderId, billerId: comprobanteEnBiller.id });

            // Obtener orden de ML para calcular el monto total
            // porque Biller NO devuelve el monto en la búsqueda
            let totalOrden = 0;

            // Primero intentar calcular desde la orden que ya tenemos
            if (orden.order_items && orden.order_items.length > 0) {
                totalOrden = calcularTotalOrden(orden);
                logger.debug('Monto calculado desde orden existente', { totalOrden });
            } else if (orden.total_amount && orden.total_amount > 0) {
                totalOrden = parseFloat(orden.total_amount);
                logger.debug('Monto desde total_amount', { totalOrden });
            } else {
                // Si la orden viene incompleta, obtenerla de ML
                logger.info('📥 Obteniendo orden completa de ML para calcular monto...', { orderId });
                const ordenCompleta = await obtenerOrdenML(orderId);
                if (ordenCompleta) {
                    totalOrden = calcularTotalOrden(ordenCompleta);
                    logger.info('Monto calculado desde ML', { orderId, totalOrden });
                }
            }

            comprobante = {
                ...comprobanteEnBiller,
                ml_order_id: orderId,
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
        logger.info('⚠️ Cancelación sin comprobante previo (ni en store ni en Biller)', { orderId });
        return { action: 'skipped', reason: 'no_invoice' };
    }

    logger.info('📋 Comprobante original encontrado', {
        orderId,
        comprobanteId: comprobante.id,
        serie: comprobante.serie,
        numero: comprobante.numero,
        total: comprobante.total || comprobante.monto_total
    });

    // Verificar NC existente en store local
    let ncExistente = store.findNCByOrderId(orderId);

    // También verificar en Biller si ya existe NC (buscar con diferentes formatos)
    if (!ncExistente) {
        // Formato 1: NC-ML-{orderId}
        const ncNumeroInterno1 = `NC-ML-${orderId}`;
        let ncEnBiller = await billerClient.buscarPorNumeroInterno(ncNumeroInterno1);

        // Formato 2: NC-ML-{orderId}-{timestamp} (puede haber varios, buscar el base)
        if (!ncEnBiller) {
            // Intenta búsqueda parcial si la API lo soporta
            logger.debug('Buscando NC con formato alternativo...', { orderId });
        }

        if (ncEnBiller) {
            logger.info('⚠️ NC ya existe en Biller para esta cancelación', { orderId, ncId: ncEnBiller.id });
            store.addNC(orderId, { ...ncEnBiller, synced_from_biller: true });
            return { action: 'skipped', reason: 'nc_exists_in_biller' };
        }
    } else {
        logger.info('⚠️ NC ya existe en store local', { orderId, ncId: ncExistente.id });
        return { action: 'skipped', reason: 'nc_exists' };
    }

    // Determinar monto para NC
    let monto = comprobante.total || comprobante.monto_total;

    // Si aún no tenemos monto, intentar obtenerlo de la orden
    if (!monto || monto <= 0) {
        logger.warn('Monto no disponible en comprobante, obteniendo de ML...', { orderId });
        const ordenML = await obtenerOrdenML(orderId);
        if (ordenML) {
            monto = calcularTotalOrden(ordenML);
        }
    }

    if (!monto || monto <= 0) {
        logger.error('❌ No se pudo determinar el monto para la NC', {
            orderId,
            comprobanteTotal: comprobante.total,
            comprobanteMontoTotal: comprobante.monto_total
        });
        return { action: 'error', reason: 'no_amount' };
    }

    logger.info('💰 Monto determinado para NC', { orderId, monto });

    // Crear claim simulado para usar la misma lógica de emisión
    const claimSimulado = {
        id: `CANCEL-${orderId}`,
        status: 'closed',
        resolution: { status: 'refunded' },
        resource_id: orderId,
        reason_id: 'Cancelación de orden'
    };

    // Emitir NC
    logger.info('📝 Emitiendo NC en Biller...', { orderId, monto, tipoOriginal: comprobante.tipo_comprobante });
    const nc = await emitirNotaCredito(claimSimulado, comprobante, monto);

    store.addNC(orderId, nc);

    logger.info('✅ NC emitida exitosamente por cancelación', {
        orderId,
        ncId: nc.id,
        ncSerie: nc.serie,
        ncNumero: nc.numero,
        monto
    });

    return { action: 'nc_emitted', nc };
}

module.exports = {
    procesarClaim,
    procesarCancelacion,
    debeEmitirNC,
    calcularMontoNC,
    emitirNotaCredito,
    anularComprobanteBiller,
    esAnulacionTotal,
    obtenerTipoNC
};
