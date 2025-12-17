/**
 * Handler para webhooks de Claims de MercadoLibre
 * Procesa devoluciones y emite Notas de Crédito
 * @module handlers/claims-handler
 */

const config = require('../config');
const logger = require('../utils/logger');
const { procesarClaim, procesarCancelacion } = require('../services/credit-note-service');

/**
 * Procesar webhook de claims
 * @param {Object} webhookData - Datos del webhook
 * @returns {Object} Resultado del procesamiento
 */
async function handleClaimWebhook(webhookData) {
    const claimResource = webhookData.resource; // /claims/123456
    const claimId = claimResource.replace('/claims/', '');

    logger.info('📨 Webhook claim recibido', { claimId, topic: webhookData.topic });

    try {
        // 1. Obtener detalles del claim desde ML API
        const claim = await obtenerDetalleClaim(claimId);

        if (!claim) {
            logger.warn('Claim no encontrado en ML', { claimId });
            return { action: 'skipped', reason: 'claim_not_found' };
        }

        // 2. Log del estado del claim
        logger.debug('Detalle del claim', {
            claimId,
            status: claim.status,
            resolution: claim.resolution?.status,
            reason: claim.reason_id,
            orderId: claim.resource_id
        });

        // 3. Procesar el claim
        const resultado = await procesarClaim(claim);

        return resultado;

    } catch (error) {
        logger.error('Error procesando webhook claim', {
            claimId,
            error: error.message,
            stack: error.stack
        });

        throw error;
    }
}

/**
 * Obtener detalle de un claim desde la API de MercadoLibre
 * @param {string} claimId 
 * @returns {Object|null}
 */
async function obtenerDetalleClaim(claimId) {
    try {
        const { getTokenManager } = require('../utils/token-manager');
        const accessToken = await getTokenManager().ensureValidToken();

        const response = await fetch(
            `https://api.mercadolibre.com/claims/${claimId}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) {
            if (response.status === 404) {
                return null;
            }

            const errorText = await response.text();
            logger.error('Error obteniendo claim', {
                claimId,
                status: response.status,
                error: errorText
            });
            return null;
        }

        return await response.json();

    } catch (error) {
        logger.error('Error consultando claim', { claimId, error: error.message });
        return null;
    }
}

async function obtenerClaimsPorOrden(orderId) {
    try {
        const { getTokenManager } = require('../utils/token-manager');
        const accessToken = await getTokenManager().ensureValidToken();

        const response = await fetch(
            `https://api.mercadolibre.com/claims/search?resource_id=${orderId}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        return data.results || [];

    } catch (error) {
        logger.error('Error buscando claims por orden', { orderId, error: error.message });
        return [];
    }
}

async function obtenerDetalleRetorno(claimId) {
    try {
        const { getTokenManager } = require('../utils/token-manager');
        const accessToken = await getTokenManager().ensureValidToken();

        const response = await fetch(
            `https://api.mercadolibre.com/post-purchase/v2/claims/${claimId}/returns`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) {
            return null;
        }

        return await response.json();

    } catch (error) {
        logger.debug('Error obteniendo detalle retorno', { claimId, error: error.message });
        return null;
    }
}

/**
 * Handler para cuando una orden es cancelada
 * Genera NC si la orden ya había sido facturada
 * @param {Object} orden - Datos de la orden cancelada
 * @returns {Object} Resultado del procesamiento
 */
async function handleOrdenCancelada(orden) {
    logger.info('🚫 Procesando orden cancelada', { orderId: orden.id, status: orden.status });

    try {
        const resultado = await procesarCancelacion(orden);
        return resultado;

    } catch (error) {
        logger.error('Error procesando orden cancelada', {
            orderId: orden.id,
            error: error.message,
            stack: error.stack
        });

        throw error;
    }
}

module.exports = {
    handleClaimWebhook,
    handleOrdenCancelada,
    obtenerDetalleClaim,
    obtenerClaimsPorOrden,
    obtenerDetalleRetorno
};
