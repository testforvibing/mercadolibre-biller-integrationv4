/**
 * Gestor de tokens de MercadoLibre con persistencia
 * SOLUCIÓN DEFINITIVA: Usa variables de entorno como fuente principal
 * Compatible con filesystem efímero de Render
 * @module utils/token-manager
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');

class TokenManager {
    constructor(filePath = './data/ml-tokens.json') {
        this.filePath = filePath;

        // Cargar tokens desde variables de entorno (FUENTE PRINCIPAL)
        this.tokens = {
            accessToken: process.env.ML_ACCESS_TOKEN || config.mercadolibre.accessToken,
            refreshToken: process.env.ML_REFRESH_TOKEN || config.mercadolibre.refreshToken,
            expiresAt: process.env.ML_TOKEN_EXPIRES_AT || null,
            userId: process.env.ML_USER_ID || config.mercadolibre.userId
        };

        // Intentar cargar desde archivo como fallback (para desarrollo local)
        this.loadFromFile();

        logger.info('TokenManager inicializado', {
            userId: this.tokens.userId,
            hasAccessToken: !!this.tokens.accessToken,
            hasRefreshToken: !!this.tokens.refreshToken,
            expiresAt: this.tokens.expiresAt,
            source: this.tokens.accessToken ? 'env/file' : 'none'
        });
    }

    /**
     * Cargar tokens desde archivo (fallback para desarrollo local)
     * En Render, el archivo puede no existir después de un restart
     */
    loadFromFile() {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));

                // Solo usar si son más recientes que los de env
                if (data.accessToken && data.savedAt) {
                    const envExpiresAt = this.tokens.expiresAt ? new Date(this.tokens.expiresAt).getTime() : 0;
                    const fileExpiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;

                    // Usar archivo solo si tiene tokens más frescos
                    if (fileExpiresAt > envExpiresAt) {
                        this.tokens = { ...this.tokens, ...data };
                        logger.info('Tokens ML cargados desde archivo (más recientes)', {
                            expiresAt: data.expiresAt,
                            savedAt: data.savedAt
                        });
                    } else {
                        logger.debug('Tokens de env son más recientes, ignorando archivo');
                    }
                }
            }
        } catch (error) {
            logger.debug('No hay tokens guardados en archivo, usando env', { error: error.message });
        }
    }

    /**
     * Guardar tokens a archivo (para desarrollo local y backup)
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
            logger.debug('Tokens ML guardados en archivo');
        } catch (error) {
            logger.warn('Error guardando tokens en archivo (normal en Render)', { error: error.message });
        }
    }

    /**
     * Actualizar variables de entorno en Render via API
     * @param {Object} tokens - Nuevos tokens a guardar
     */
    async updateRenderEnvVars(tokens) {
        const renderApiKey = process.env.RENDER_API_KEY;
        const renderServiceId = process.env.RENDER_SERVICE_ID;

        if (!renderApiKey || !renderServiceId) {
            logger.debug('Render API no configurada, tokens solo en memoria/archivo');
            return false;
        }

        try {
            // Obtener env vars actuales
            const getResponse = await fetch(
                `https://api.render.com/v1/services/${renderServiceId}/env-vars`,
                {
                    headers: {
                        'Authorization': `Bearer ${renderApiKey}`,
                        'Accept': 'application/json'
                    }
                }
            );

            if (!getResponse.ok) {
                throw new Error(`Error obteniendo env vars: ${getResponse.status}`);
            }

            const currentEnvVars = await getResponse.json();

            // Preparar actualizaciones
            const envVarsToUpdate = [];

            // Buscar y actualizar las variables existentes
            const varsToSet = {
                'ML_ACCESS_TOKEN': tokens.accessToken,
                'ML_REFRESH_TOKEN': tokens.refreshToken,
                'ML_TOKEN_EXPIRES_AT': tokens.expiresAt,
                'ML_USER_ID': tokens.userId?.toString()
            };

            for (const [key, value] of Object.entries(varsToSet)) {
                if (value) {
                    envVarsToUpdate.push({ key, value });
                }
            }

            // Actualizar cada variable
            for (const envVar of envVarsToUpdate) {
                const updateResponse = await fetch(
                    `https://api.render.com/v1/services/${renderServiceId}/env-vars/${envVar.key}`,
                    {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${renderApiKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ value: envVar.value })
                    }
                );

                if (!updateResponse.ok) {
                    // Si no existe, crearla
                    const createResponse = await fetch(
                        `https://api.render.com/v1/services/${renderServiceId}/env-vars`,
                        {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${renderApiKey}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify([{ key: envVar.key, value: envVar.value }])
                        }
                    );

                    if (!createResponse.ok) {
                        logger.warn(`Error creando env var ${envVar.key}`, { status: createResponse.status });
                    }
                }
            }

            logger.info('✅ Variables de entorno actualizadas en Render', {
                userId: tokens.userId,
                expiresAt: tokens.expiresAt
            });

            return true;

        } catch (error) {
            logger.error('Error actualizando env vars en Render', { error: error.message });
            return false;
        }
    }

    /**
     * Guardar tokens (archivo + Render API si está configurada)
     */
    async save() {
        // 1. Guardar en archivo (para desarrollo local)
        this.saveToFile();

        // 2. Intentar actualizar en Render (para producción)
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
            userId: this.tokens.userId,
            isExpired: this.isExpired(),
            isExpiringSoon: this.isExpiringSoon()
        };
    }

    /**
     * Verificar si token ya expiró
     */
    isExpired() {
        if (!this.tokens.expiresAt) return false;
        return Date.now() > new Date(this.tokens.expiresAt).getTime();
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

        logger.info('Token ML expirando, renovando...', {
            expiresAt: this.tokens.expiresAt
        });

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
        if (!this.tokens.refreshToken) {
            throw new Error('No hay refresh_token disponible. Debes re-autorizar en /auth/mercadolibre');
        }

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

        // Actualizar tokens en memoria
        this.tokens.accessToken = data.access_token;
        this.tokens.refreshToken = data.refresh_token;
        this.tokens.expiresAt = new Date(Date.now() + (data.expires_in * 1000)).toISOString();
        this.tokens.userId = data.user_id;

        // Persistir (archivo + Render si está configurado)
        await this.save();

        logger.info('✅ Token ML renovado exitosamente', {
            expiresIn: data.expires_in,
            expiresAt: this.tokens.expiresAt,
            userId: data.user_id
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
    async updateTokens(accessToken, refreshToken, expiresIn, userId) {
        this.tokens.accessToken = accessToken;
        this.tokens.refreshToken = refreshToken;
        this.tokens.expiresAt = new Date(Date.now() + (expiresIn * 1000)).toISOString();
        this.tokens.userId = userId;

        // Persistir (archivo + Render si está configurado)
        await this.save();

        logger.info('✅ Tokens ML actualizados', {
            userId,
            expiresAt: this.tokens.expiresAt
        });
    }

    /**
     * Establecer tokens manualmente (para API)
     */
    async setTokens(accessToken, refreshToken, expiresAt, userId) {
        this.tokens.accessToken = accessToken;
        this.tokens.refreshToken = refreshToken;
        this.tokens.expiresAt = expiresAt;
        this.tokens.userId = userId;

        await this.save();

        logger.info('Tokens establecidos manualmente', { userId });
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
