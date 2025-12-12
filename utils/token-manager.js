/**
 * Gestor de tokens de MercadoLibre con persistencia
 * Renueva automáticamente y persiste tokens en disco
 * @module utils/token-manager
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');

class TokenManager {
    constructor(filePath = './data/ml-tokens.json') {
        this.filePath = filePath;
        this.tokens = {
            accessToken: config.mercadolibre.accessToken,
            refreshToken: config.mercadolibre.refreshToken,
            expiresAt: null,
            userId: config.mercadolibre.userId
        };

        this.load();
    }

    /**
     * Cargar tokens desde disco
     */
    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));

                // Solo usar si son más recientes que los de .env
                if (data.accessToken && data.savedAt) {
                    this.tokens = { ...this.tokens, ...data };
                    logger.info('Tokens ML cargados desde archivo', {
                        expiresAt: data.expiresAt,
                        savedAt: data.savedAt
                    });
                }
            }
        } catch (error) {
            logger.debug('No hay tokens guardados, usando .env');
        }
    }

    /**
     * Guardar tokens a disco
     */
    save() {
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
            logger.debug('Tokens ML guardados');
        } catch (error) {
            logger.error('Error guardando tokens', { error: error.message });
        }
    }

    /**
     * Obtener access token actual
     */
    getAccessToken() {
        return this.tokens.accessToken;
    }

    /**
     * Verificar si token está por expirar
     * @param {number} marginMinutes - Minutos de margen (default: 30)
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

        logger.info('Token ML expirando, renovando...');

        try {
            const newTokens = await this.refreshToken();
            return newTokens.accessToken;
        } catch (error) {
            logger.error('Error renovando token ML', { error: error.message });
            // Retornar token actual aunque esté por expirar
            return this.tokens.accessToken;
        }
    }

    /**
     * Refrescar token usando refresh_token
     */
    async refreshToken() {
        const response = await fetch('https://api.mercadolibre.com/oauth/token', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: config.mercadolibre.appId,
                client_secret: config.mercadolibre.appSecret,
                refresh_token: this.tokens.refreshToken
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error renovando token: ${response.status} - ${errorText}`);
        }

        const data = await response.json();

        // Actualizar tokens
        this.tokens.accessToken = data.access_token;
        this.tokens.refreshToken = data.refresh_token;
        this.tokens.expiresAt = new Date(Date.now() + (data.expires_in * 1000)).toISOString();
        this.tokens.userId = data.user_id;

        // Persistir
        this.save();

        logger.info('Token ML renovado exitosamente', {
            expiresIn: data.expires_in,
            expiresAt: this.tokens.expiresAt
        });

        return {
            accessToken: this.tokens.accessToken,
            refreshToken: this.tokens.refreshToken,
            expiresIn: data.expires_in
        };
    }

    /**
     * Actualizar tokens después de OAuth inicial
     */
    updateTokens(accessToken, refreshToken, expiresIn, userId) {
        this.tokens.accessToken = accessToken;
        this.tokens.refreshToken = refreshToken;
        this.tokens.expiresAt = new Date(Date.now() + (expiresIn * 1000)).toISOString();
        this.tokens.userId = userId;

        this.save();

        logger.info('Tokens ML actualizados', { userId, expiresAt: this.tokens.expiresAt });
    }
}

// Singleton
let tokenManagerInstance = null;

function getTokenManager() {
    if (!tokenManagerInstance) {
        tokenManagerInstance = new TokenManager();
    }
    return tokenManagerInstance;
}

module.exports = {
    TokenManager,
    getTokenManager
};
