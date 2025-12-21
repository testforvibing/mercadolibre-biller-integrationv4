/**
 * Middleware de autenticacion para Wix App
 * Verifica la firma de instancia de Wix
 * @module middleware/wix-app-auth
 */

const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Middleware para autenticar requests de la Wix App
 * Wix envia un instance token firmado en el header Authorization
 *
 * Formato: Authorization: Bearer <base64(signature)>.<base64(data)>
 */
function wixAppAuth(req, res, next) {
  const authHeader = req.headers['authorization'];

  // Permitir requests en desarrollo sin auth
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_WIX_AUTH === 'true') {
    req.wixApp = {
      instanceId: 'dev-instance',
      appDefId: 'dev-app',
      signDate: new Date().toISOString(),
      uid: 'dev-user',
      permissions: 'OWNER'
    };
    return next();
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Wix App Auth: Missing authorization header');
    return res.status(401).json({
      error: 'Missing authorization',
      code: 'AUTH_MISSING'
    });
  }

  const instance = authHeader.replace('Bearer ', '');

  try {
    // Decodificar y verificar instancia Wix
    const instanceData = decodeWixInstance(instance);

    if (!instanceData) {
      throw new Error('Invalid instance data');
    }

    // Adjuntar datos de instancia al request
    req.wixApp = {
      instanceId: instanceData.instanceId,
      appDefId: instanceData.appDefId,
      signDate: instanceData.signDate,
      uid: instanceData.uid,
      permissions: instanceData.permissions,
      siteOwnerId: instanceData.siteOwnerId,
      siteMemberId: instanceData.siteMemberId
    };

    logger.debug('Wix App Auth: Request authenticated', {
      instanceId: instanceData.instanceId,
      permissions: instanceData.permissions
    });

    next();
  } catch (error) {
    logger.warn('Wix App Auth: Invalid authorization', { error: error.message });
    res.status(401).json({
      error: 'Invalid authorization',
      code: 'AUTH_INVALID',
      message: error.message
    });
  }
}

/**
 * Decodificar y verificar instancia Wix
 * @param {string} instance - Token de instancia (signature.data)
 * @returns {Object|null} - Datos de instancia decodificados
 */
function decodeWixInstance(instance) {
  const parts = instance.split('.');

  if (parts.length !== 2) {
    throw new Error('Invalid instance format: expected signature.data');
  }

  const [signature, data] = parts;

  // Obtener secret (puede ser WIX_APP_SECRET o WIX_CLIENT_SECRET)
  const secret = process.env.WIX_APP_SECRET || config.wix.clientSecret;

  if (!secret) {
    throw new Error('WIX_APP_SECRET or WIX_CLIENT_SECRET not configured');
  }

  // Calcular firma esperada
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Verificar firma
  if (!crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )) {
    throw new Error('Invalid signature');
  }

  // Decodificar datos
  const decodedData = Buffer.from(data, 'base64').toString('utf8');
  const instanceData = JSON.parse(decodedData);

  // Verificar timestamp (opcional - prevenir replay attacks)
  if (instanceData.signDate) {
    const signedAt = new Date(instanceData.signDate).getTime();
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 horas

    if (now - signedAt > maxAge) {
      logger.warn('Wix instance token expired', {
        signedAt: instanceData.signDate,
        age: now - signedAt
      });
      // No fallar por ahora, solo loggear
    }
  }

  return instanceData;
}

/**
 * Middleware para verificar permisos de admin
 */
function requireOwner(req, res, next) {
  if (!req.wixApp) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (req.wixApp.permissions !== 'OWNER') {
    return res.status(403).json({
      error: 'Owner access required',
      code: 'FORBIDDEN'
    });
  }

  next();
}

/**
 * Generar instancia para testing
 * Solo usar en desarrollo
 */
function generateTestInstance(instanceData) {
  const secret = process.env.WIX_APP_SECRET || config.wix.clientSecret;

  if (!secret) {
    throw new Error('Secret not configured');
  }

  const data = Buffer.from(JSON.stringify({
    instanceId: instanceData.instanceId || 'test-instance',
    appDefId: instanceData.appDefId || 'test-app',
    signDate: new Date().toISOString(),
    uid: instanceData.uid || 'test-user',
    permissions: instanceData.permissions || 'OWNER',
    ...instanceData
  })).toString('base64');

  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signature}.${data}`;
}

module.exports = {
  wixAppAuth,
  requireOwner,
  decodeWixInstance,
  generateTestInstance
};
