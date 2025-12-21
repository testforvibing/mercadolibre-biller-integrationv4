/**
 * Gestor de tokens de Wix con persistencia
 * Compatible con filesystem efimero de Render
 * @module utils/wix-token-manager
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');

class WixTokenManager {
  constructor(filePath = './data/wix-tokens.json') {
    this.filePath = filePath;

    // Cargar tokens desde variables de entorno (FUENTE PRINCIPAL)
    this.tokens = {
      accessToken: process.env.WIX_ACCESS_TOKEN || config.wix.accessToken,
      refreshToken: process.env.WIX_REFRESH_TOKEN || config.wix.refreshToken,
      expiresAt: process.env.WIX_TOKEN_EXPIRES_AT || null,
      siteId: process.env.WIX_SITE_ID || config.wix.siteId
    };

    // Intentar cargar desde archivo como fallback
    this.loadFromFile();

    logger.info('WixTokenManager inicializado', {
      siteId: this.tokens.siteId,
      hasAccessToken: !!this.tokens.accessToken,
      hasRefreshToken: !!this.tokens.refreshToken,
      expiresAt: this.tokens.expiresAt
    });
  }

  /**
   * Cargar tokens desde archivo (fallback para desarrollo local)
   */
  loadFromFile() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));

        if (data.accessToken && data.savedAt) {
          const envExpiresAt = this.tokens.expiresAt ? new Date(this.tokens.expiresAt).getTime() : 0;
          const fileExpiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;

          if (fileExpiresAt > envExpiresAt) {
            this.tokens = { ...this.tokens, ...data };
            logger.info('Tokens Wix cargados desde archivo (mas recientes)', {
              expiresAt: data.expiresAt
            });
          }
        }
      }
    } catch (error) {
      logger.debug('No hay tokens guardados en archivo', { error: error.message });
    }
  }

  /**
   * Guardar tokens a archivo
   */
  saveToFile() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        ...this.tokens,
        savedAt: new Date().toISOString()
      };

      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
      logger.debug('Tokens Wix guardados en archivo');
    } catch (error) {
      logger.warn('Error guardando tokens en archivo', { error: error.message });
    }
  }

  /**
   * Actualizar variables de entorno en Render via API
   */
  async updateRenderEnvVars(tokens) {
    const renderApiKey = process.env.RENDER_API_KEY;
    const renderServiceId = process.env.RENDER_SERVICE_ID;

    if (!renderApiKey || !renderServiceId) {
      logger.debug('Render API no configurada, tokens solo en memoria/archivo');
      return false;
    }

    try {
      const varsToSet = {
        'WIX_ACCESS_TOKEN': tokens.accessToken,
        'WIX_REFRESH_TOKEN': tokens.refreshToken,
        'WIX_TOKEN_EXPIRES_AT': tokens.expiresAt,
        'WIX_SITE_ID': tokens.siteId
      };

      for (const [key, value] of Object.entries(varsToSet)) {
        if (!value) continue;

        const updateResponse = await fetch(
          `https://api.render.com/v1/services/${renderServiceId}/env-vars/${key}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${renderApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ value })
          }
        );

        if (!updateResponse.ok) {
          // Si no existe, crearla
          await fetch(
            `https://api.render.com/v1/services/${renderServiceId}/env-vars`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${renderApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify([{ key, value }])
            }
          );
        }
      }

      logger.info('Variables de entorno actualizadas en Render');
      return true;

    } catch (error) {
      logger.error('Error actualizando env vars en Render', { error: error.message });
      return false;
    }
  }

  /**
   * Guardar tokens (archivo + Render API si esta configurada)
   */
  async save() {
    this.saveToFile();
    await this.updateRenderEnvVars(this.tokens);
  }

  /**
   * Obtener access token actual
   */
  getAccessToken() {
    return this.tokens.accessToken;
  }

  /**
   * Obtener todos los tokens (para debug/API)
   */
  getTokens() {
    return {
      accessToken: this.tokens.accessToken ? '***' + this.tokens.accessToken.slice(-10) : null,
      refreshToken: this.tokens.refreshToken ? '***' + this.tokens.refreshToken.slice(-10) : null,
      expiresAt: this.tokens.expiresAt,
      siteId: this.tokens.siteId,
      isExpired: this.isExpired(),
      isExpiringSoon: this.isExpiringSoon()
    };
  }

  /**
   * Verificar si token ya expiro
   */
  isExpired() {
    if (!this.tokens.expiresAt) return false;
    return Date.now() > new Date(this.tokens.expiresAt).getTime();
  }

  /**
   * Verificar si token esta por expirar (margen: 30 min)
   */
  isExpiringSoon(marginMinutes = 30) {
    if (!this.tokens.expiresAt) return false;
    const expiresAt = new Date(this.tokens.expiresAt).getTime();
    const margin = marginMinutes * 60 * 1000;
    return Date.now() > (expiresAt - margin);
  }

  /**
   * Refrescar token si es necesario
   */
  async ensureValidToken() {
    if (!this.isExpiringSoon()) {
      return this.tokens.accessToken;
    }

    logger.info('Token Wix expirando, renovando...');

    try {
      const newTokens = await this.refreshToken();
      return newTokens.accessToken;
    } catch (error) {
      logger.error('Error renovando token Wix', { error: error.message });
      return this.tokens.accessToken;
    }
  }

  /**
   * Refrescar token usando refresh_token
   * Wix access tokens son validos por 4 horas
   */
  async refreshToken() {
    if (!this.tokens.refreshToken) {
      throw new Error('No hay refresh_token disponible. Debes re-autorizar en /auth/wix');
    }

    const response = await fetch('https://www.wix.com/oauth/access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: config.wix.clientId,
        client_secret: config.wix.clientSecret,
        refresh_token: this.tokens.refreshToken
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error renovando token: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Actualizar tokens en memoria
    this.tokens.accessToken = data.access_token;
    this.tokens.refreshToken = data.refresh_token;
    // Wix tokens expiran en 4 horas
    this.tokens.expiresAt = new Date(Date.now() + (data.expires_in || 14400) * 1000).toISOString();

    // Persistir
    await this.save();

    logger.info('Token Wix renovado exitosamente', {
      expiresAt: this.tokens.expiresAt
    });

    return {
      accessToken: this.tokens.accessToken,
      refreshToken: this.tokens.refreshToken,
      expiresIn: data.expires_in || 14400
    };
  }

  /**
   * Actualizar tokens despues de OAuth inicial
   */
  async updateTokens(accessToken, refreshToken, expiresIn, siteId) {
    this.tokens.accessToken = accessToken;
    this.tokens.refreshToken = refreshToken;
    this.tokens.expiresAt = new Date(Date.now() + (expiresIn * 1000)).toISOString();
    this.tokens.siteId = siteId || this.tokens.siteId;

    await this.save();

    logger.info('Tokens Wix actualizados', {
      siteId: this.tokens.siteId,
      expiresAt: this.tokens.expiresAt
    });
  }
}

// Singleton
let wixTokenManagerInstance = null;

function getWixTokenManager() {
  if (!wixTokenManagerInstance) {
    wixTokenManagerInstance = new WixTokenManager();
  }
  return wixTokenManagerInstance;
}

module.exports = {
  WixTokenManager,
  getWixTokenManager
};
