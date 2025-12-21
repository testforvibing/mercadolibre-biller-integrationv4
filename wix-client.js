/**
 * Cliente para la API de Wix eCommerce
 * Maneja autenticacion OAuth, ordenes y verificacion de webhooks
 * @module wix-client
 */

const crypto = require('crypto');
const config = require('./config');
const logger = require('./utils/logger');

class WixClient {
  constructor() {
    this.baseUrl = config.wix.apiBaseUrl;
    this.timeout = config.wix.timeout;
  }

  /**
   * Obtener headers de autenticacion
   * @returns {Object} Headers con Authorization
   */
  getAuthHeaders() {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      throw new Error('No hay access token de Wix configurado');
    }

    return {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  /**
   * Obtener access token actual
   * @returns {string|null}
   */
  getAccessToken() {
    // Primero intentar desde token manager si existe
    try {
      const { getWixTokenManager } = require('./utils/wix-token-manager');
      return getWixTokenManager().getAccessToken();
    } catch (e) {
      // Fallback a config
      return config.wix.accessToken;
    }
  }

  /**
   * Verificar webhook JWT de Wix
   * @param {string} token - JWT del webhook
   * @returns {Object} Payload decodificado
   */
  verifyWebhook(token) {
    const publicKey = config.wix.webhookPublicKey;

    if (!publicKey) {
      // SEGURIDAD: En producción NUNCA aceptar webhooks sin verificar
      if (config.biller.environment === 'production') {
        throw new Error('WIX_WEBHOOK_PUBLIC_KEY es obligatoria en producción. Rechazando webhook.');
      }
      logger.warn('WIX_WEBHOOK_PUBLIC_KEY no configurada, aceptando webhook sin verificar (SOLO DESARROLLO)');
      // Decodificar sin verificar (solo para desarrollo)
      return this.decodeJwtWithoutVerification(token);
    }

    try {
      // Verificar JWT con la public key
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });

      // Verificar que no haya expirado
      if (decoded.exp && Date.now() >= decoded.exp * 1000) {
        throw new Error('Token expirado');
      }

      return decoded;
    } catch (error) {
      logger.error('Error verificando JWT de Wix', { error: error.message });
      throw new Error(`JWT invalido: ${error.message}`);
    }
  }

  /**
   * Decodificar JWT sin verificar firma (solo para desarrollo)
   * @param {string} token
   * @returns {Object}
   */
  decodeJwtWithoutVerification(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Token JWT malformado');
      }

      const payload = Buffer.from(parts[1], 'base64').toString('utf8');
      return JSON.parse(payload);
    } catch (error) {
      throw new Error(`Error decodificando JWT: ${error.message}`);
    }
  }

  /**
   * Obtener orden por ID
   * @param {string} orderId - ID de la orden
   * @returns {Object|null} Orden o null si no existe
   */
  async getOrder(orderId) {
    try {
      const response = await fetch(
        `${this.baseUrl}/ecom/v1/orders/${orderId}`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
          signal: AbortSignal.timeout(this.timeout)
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug('Orden Wix no encontrada', { orderId });
          return null;
        }
        const errorText = await response.text();
        logger.error('Error obteniendo orden Wix', { orderId, status: response.status, error: errorText });
        throw new Error(`Error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      return data.order || data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Timeout obteniendo orden de Wix');
      }
      throw error;
    }
  }

  /**
   * Buscar ordenes con filtros
   * @param {Object} filters - Filtros de busqueda
   * @returns {Array} Lista de ordenes
   */
  async searchOrders(filters = {}) {
    try {
      const queryParams = new URLSearchParams();

      if (filters.status) {
        queryParams.append('status', filters.status);
      }
      if (filters.paymentStatus) {
        queryParams.append('paymentStatus', filters.paymentStatus);
      }
      if (filters.limit) {
        queryParams.append('limit', filters.limit.toString());
      }

      const url = `${this.baseUrl}/ecom/v1/orders/query`;

      const response = await fetch(url, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          query: {
            filter: filters.filter || {},
            sort: filters.sort || [{ fieldName: '_createdDate', order: 'DESC' }],
            paging: {
              limit: filters.limit || 50
            }
          }
        }),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error buscando ordenes: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return data.orders || [];
    } catch (error) {
      logger.error('Error buscando ordenes Wix', { error: error.message });
      throw error;
    }
  }

  /**
   * Normalizar orden de Wix a formato interno
   * @param {Object} wixOrder - Orden de Wix
   * @returns {Object} Orden normalizada
   */
  normalizeOrder(wixOrder) {
    const billingInfo = wixOrder.billingInfo || {};
    const contactDetails = billingInfo.contactDetails || {};
    const address = billingInfo.address || {};
    const priceSummary = wixOrder.priceSummary || {};
    const buyerInfo = wixOrder.buyerInfo || {};

    // Extraer datos fiscales
    const vatId = contactDetails.vatId || {};
    const documento = vatId.id?.replace(/\D/g, '') || null;
    const tipoDocumento = vatId.type || null;

    // Calcular total
    const total = parseFloat(priceSummary.total?.amount || 0);

    // Normalizar items
    const items = (wixOrder.lineItems || []).map(item => ({
      id: item.id,
      nombre: item.productName?.translated || item.productName?.original || 'Producto',
      cantidad: parseInt(item.quantity) || 1,
      precioUnitario: parseFloat(item.price) || 0,
      precioTotal: parseFloat(item.totalPrice) || 0,
      iva: item.taxDetails?.taxRate ? parseFloat(item.taxDetails.taxRate) : 22
    }));

    // Agregar shipping como item si existe
    const shippingCost = parseFloat(priceSummary.shipping?.amount || 0);
    if (shippingCost > 0) {
      items.push({
        id: 'shipping',
        nombre: 'Envio',
        cantidad: 1,
        precioUnitario: shippingCost,
        precioTotal: shippingCost,
        iva: 22
      });
    }

    return {
      id: wixOrder.id,
      number: wixOrder.number,
      status: wixOrder.status,
      paymentStatus: wixOrder.paymentStatus,
      createdDate: wixOrder._createdDate,
      updatedDate: wixOrder._updatedDate,

      // Comprador
      buyer: {
        email: buyerInfo.email,
        firstName: buyerInfo.firstName || contactDetails.firstName,
        lastName: buyerInfo.lastName || contactDetails.lastName,
        phone: contactDetails.phone
      },

      // Datos fiscales
      fiscal: {
        documento: documento,
        tipoDocumento: tipoDocumento,
        razonSocial: contactDetails.company,
        nombreCompleto: [contactDetails.firstName, contactDetails.lastName].filter(Boolean).join(' ')
      },

      // Direccion
      direccion: {
        linea1: address.addressLine1,
        linea2: address.addressLine2,
        ciudad: address.city,
        departamento: address.subdivision,
        codigoPostal: address.postalCode,
        pais: address.country || 'UY'
      },

      // Montos
      montos: {
        subtotal: parseFloat(priceSummary.subtotal?.amount || 0),
        shipping: shippingCost,
        tax: parseFloat(priceSummary.tax?.amount || 0),
        total: total,
        moneda: priceSummary.total?.currency || 'UYU'
      },

      // Items
      items: items,

      // Info de impuestos
      taxInfo: {
        ivaIncluido: wixOrder.taxInfo?.taxIncludedInPrices || true,
        totalIva: parseFloat(wixOrder.taxInfo?.totalTax || 0)
      },

      // Original para referencia
      _original: wixOrder
    };
  }

  /**
   * Verificar conexion con Wix
   * @returns {Object} Estado de conexion
   */
  async verificarConexion() {
    try {
      // Intentar obtener ordenes recientes como prueba
      const orders = await this.searchOrders({ limit: 1 });
      return {
        conectado: true,
        mensaje: 'Conexion exitosa con Wix API'
      };
    } catch (error) {
      return {
        conectado: false,
        mensaje: error.message
      };
    }
  }
}

// ============================================================
// FUNCIONES OAUTH
// ============================================================

/**
 * Generar URL de autorizacion OAuth
 * @returns {string} URL de autorizacion
 */
function getAuthorizationUrl() {
  const params = new URLSearchParams({
    client_id: config.wix.clientId,
    redirect_uri: config.wix.redirectUri,
    scope: 'offline_access'
  });

  return `https://www.wix.com/installer/install?${params.toString()}`;
}

/**
 * Intercambiar codigo de autorizacion por tokens
 * @param {string} code - Codigo de autorizacion
 * @returns {Object} Tokens
 */
async function exchangeCodeForTokens(code) {
  const response = await fetch('https://www.wix.com/oauth/access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: config.wix.clientId,
      client_secret: config.wix.clientSecret,
      code: code
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error obteniendo tokens: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in
  };
}

/**
 * Refrescar access token
 * @param {string} refreshToken - Refresh token
 * @returns {Object} Nuevos tokens
 */
async function refreshAccessToken(refreshToken) {
  const response = await fetch('https://www.wix.com/oauth/access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: config.wix.clientId,
      client_secret: config.wix.clientSecret,
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error refrescando token: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in
  };
}

// Singleton
let wixClientInstance = null;

function getWixClient() {
  if (!wixClientInstance) {
    wixClientInstance = new WixClient();
  }
  return wixClientInstance;
}

module.exports = {
  WixClient,
  getWixClient,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken
};
