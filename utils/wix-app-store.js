/**
 * Sistema de persistencia para configuracion de Wix App
 * Almacena settings por instanceId (sitio Wix)
 * @module utils/wix-app-store
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const config = require('../config');

class WixAppSettingsStore {
  constructor(filePath) {
    this.filePath = filePath || path.join(
      path.dirname(config.storage.comprobantesFile),
      'wix-app-settings.json'
    );
    this.data = new Map();
    this.dirty = false;
    this.saveInterval = null;

    // Crear directorio si no existe
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Cargar datos existentes
    this.load();

    // Configurar auto-save
    this.startAutoSave();
  }

  /**
   * Cargar datos desde archivo
   */
  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(content);

        if (parsed.settings) {
          for (const [key, value] of Object.entries(parsed.settings)) {
            this.data.set(key, value);
          }
        }

        logger.info(`Cargados ${this.data.size} settings de Wix App desde storage`);
      }
    } catch (error) {
      logger.error('Error cargando settings de Wix App', { error: error.message });
    }
  }

  /**
   * Guardar datos a archivo
   */
  save() {
    if (!this.dirty) return;

    try {
      const obj = {
        version: 1,
        updated_at: new Date().toISOString(),
        total: this.data.size,
        settings: Object.fromEntries(this.data)
      };

      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(obj, null, 2));
      fs.renameSync(tempPath, this.filePath);

      this.dirty = false;
      logger.debug('Settings de Wix App guardados', { total: this.data.size });
    } catch (error) {
      logger.error('Error guardando settings de Wix App', { error: error.message });
    }
  }

  /**
   * Iniciar auto-save periodico
   */
  startAutoSave() {
    const interval = (config.storage.autoSaveInterval || 30) * 1000;

    this.saveInterval = setInterval(() => {
      this.save();
    }, interval);

    this.saveInterval.unref();
  }

  /**
   * Detener auto-save
   */
  stopAutoSave() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    this.save();
  }

  /**
   * Obtener settings de un sitio
   * @param {string} instanceId - ID de instancia Wix
   * @returns {Object|null}
   */
  get(instanceId) {
    return this.data.get(instanceId) || null;
  }

  /**
   * Guardar settings de un sitio
   * @param {string} instanceId - ID de instancia Wix
   * @param {Object} settings - Configuracion a guardar
   */
  set(instanceId, settings) {
    const existing = this.data.get(instanceId) || {};

    const entry = {
      ...existing,
      ...settings,
      updated_at: new Date().toISOString()
    };

    // Si es nuevo, agregar created_at
    if (!existing.created_at) {
      entry.created_at = new Date().toISOString();
    }

    this.data.set(instanceId, entry);
    this.dirty = true;

    logger.debug('Settings de Wix App guardados', { instanceId });

    return entry;
  }

  /**
   * Actualizar settings parcialmente (merge)
   * @param {string} instanceId
   * @param {Object} partialSettings
   */
  update(instanceId, partialSettings) {
    const existing = this.get(instanceId) || {};

    // Deep merge
    const merged = deepMerge(existing, partialSettings);
    return this.set(instanceId, merged);
  }

  /**
   * Eliminar settings de un sitio
   * @param {string} instanceId
   */
  delete(instanceId) {
    const existed = this.data.delete(instanceId);
    if (existed) {
      this.dirty = true;
      logger.info('Settings de Wix App eliminados', { instanceId });
    }
    return existed;
  }

  /**
   * Verificar si existe configuracion
   * @param {string} instanceId
   */
  has(instanceId) {
    return this.data.has(instanceId);
  }

  /**
   * Obtener todos los settings
   */
  getAll() {
    return Array.from(this.data.entries()).map(([instanceId, settings]) => ({
      instanceId,
      ...settings
    }));
  }

  /**
   * Obtener configuracion de Biller para un sitio
   * Si no hay config especifica, usa los valores por defecto de config.js
   * @param {string} instanceId
   */
  getBillerConfig(instanceId) {
    const siteSettings = this.get(instanceId);

    // Merge con defaults
    return {
      token: siteSettings?.biller?.token || config.biller.token,
      empresaId: siteSettings?.biller?.empresaId || config.biller.empresa.id,
      empresaRut: siteSettings?.biller?.empresaRut || config.biller.empresa.rut,
      sucursal: siteSettings?.biller?.sucursal || config.biller.empresa.sucursal,
      ambiente: siteSettings?.biller?.ambiente || config.biller.environment,
      // Flag para indicar si usa config personalizada
      isCustomConfig: !!siteSettings?.biller?.token
    };
  }

  /**
   * Obtener configuracion DGI para un sitio
   * @param {string} instanceId
   */
  getDGIConfig(instanceId) {
    const siteSettings = this.get(instanceId);

    return {
      valorUI: siteSettings?.dgi?.valorUI || config.dgi.valorUI,
      margenSeguridad: siteSettings?.dgi?.margenSeguridad || config.dgi.margenSeguridad,
      limiteUI: config.dgi.limiteUI,
      get limiteMontoUYU() {
        return Math.floor(this.limiteUI * this.valorUI * this.margenSeguridad);
      }
    };
  }

  /**
   * Estadisticas del store
   */
  getStats() {
    return {
      total: this.data.size,
      sites: Array.from(this.data.keys())
    };
  }
}

/**
 * Deep merge de objetos
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

// Singleton
let settingsStore = null;

function getSettingsStore() {
  if (!settingsStore) {
    settingsStore = new WixAppSettingsStore();
  }
  return settingsStore;
}

module.exports = {
  WixAppSettingsStore,
  getSettingsStore
};
