/**
 * Sistema de persistencia para errores del dashboard
 * Almacena errores con clasificación por tipo y severidad
 * @module utils/error-store
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const config = require('../config');

/**
 * Tipos de error soportados
 */
const ERROR_TYPES = {
  WEBHOOK: 'webhook',
  BILLER: 'biller',
  ML_API: 'ml_api',
  PDF: 'pdf',
  RECONCILIATION: 'reconciliation',
  SYSTEM: 'system'
};

/**
 * Niveles de severidad
 */
const SEVERITY_LEVELS = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
};

class ErrorStore {
  constructor(filePath) {
    this.filePath = filePath || path.join(config.storage?.dataDir || './data', 'errors.json');
    this.errors = [];
    this.maxErrors = 1000; // Mantener últimos 1000 errores
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
   * Cargar errores desde archivo
   */
  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(content);

        if (parsed.errors && Array.isArray(parsed.errors)) {
          this.errors = parsed.errors;
          logger.info(`Cargados ${this.errors.length} errores desde storage`);
        }
      }
    } catch (error) {
      logger.error('Error cargando errores', { error: error.message });
      this.errors = [];
    }
  }

  /**
   * Guardar errores a archivo
   */
  save() {
    if (!this.dirty) return;

    try {
      const obj = {
        version: 1,
        updated_at: new Date().toISOString(),
        total: this.errors.length,
        errors: this.errors
      };

      // Escribir a archivo temporal primero (atomic write)
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(obj, null, 2));
      fs.renameSync(tempPath, this.filePath);

      this.dirty = false;
      logger.debug('Errores guardados', { total: this.errors.length });
    } catch (error) {
      logger.error('Error guardando errores', { error: error.message });
    }
  }

  /**
   * Iniciar auto-save periódico
   */
  startAutoSave() {
    const interval = (config.storage?.autoSaveInterval || 30) * 1000;

    this.saveInterval = setInterval(() => {
      this.save();
    }, interval);

    // No bloquear el proceso
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
   * Agregar un nuevo error
   * @param {string} type - Tipo de error (webhook, biller, ml_api, pdf, reconciliation, system)
   * @param {string} severity - Severidad (critical, high, medium, low)
   * @param {string} source - Fuente del error (función/módulo)
   * @param {string} message - Mensaje de error
   * @param {Object} context - Contexto adicional
   * @returns {Object} Error creado
   */
  addError(type, severity, source, message, context = {}) {
    const error = {
      id: `err-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      type: type || ERROR_TYPES.SYSTEM,
      severity: severity || SEVERITY_LEVELS.MEDIUM,
      source,
      message,
      context: {
        ...context,
        // Sanitizar datos sensibles
        ...(context.token && { token: '[REDACTED]' }),
        ...(context.accessToken && { accessToken: '[REDACTED]' })
      },
      resolved: false,
      resolvedAt: null,
      resolvedBy: null
    };

    // Agregar al inicio (más reciente primero)
    this.errors.unshift(error);

    // Limitar tamaño
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(0, this.maxErrors);
    }

    this.dirty = true;

    // Log del error
    logger.warn('Error registrado en ErrorStore', {
      id: error.id,
      type: error.type,
      severity: error.severity,
      source: error.source
    });

    return error;
  }

  /**
   * Obtener errores con filtros opcionales
   * @param {Object} filters - Filtros
   * @returns {Array} Errores filtrados
   */
  getErrors(filters = {}) {
    let result = [...this.errors];

    if (filters.type) {
      result = result.filter(e => e.type === filters.type);
    }

    if (filters.severity) {
      result = result.filter(e => e.severity === filters.severity);
    }

    if (filters.resolved !== undefined) {
      result = result.filter(e => e.resolved === filters.resolved);
    }

    if (filters.source) {
      result = result.filter(e => e.source && e.source.includes(filters.source));
    }

    if (filters.desde) {
      const desde = new Date(filters.desde);
      result = result.filter(e => new Date(e.timestamp) >= desde);
    }

    if (filters.hasta) {
      const hasta = new Date(filters.hasta);
      result = result.filter(e => new Date(e.timestamp) <= hasta);
    }

    if (filters.limit) {
      result = result.slice(0, parseInt(filters.limit));
    }

    return result;
  }

  /**
   * Marcar error como resuelto
   * @param {string} errorId - ID del error
   * @param {string} resolvedBy - Quién lo resolvió
   * @returns {Object|null} Error actualizado o null si no existe
   */
  markResolved(errorId, resolvedBy = 'manual') {
    const error = this.errors.find(e => e.id === errorId);

    if (error) {
      error.resolved = true;
      error.resolvedAt = new Date().toISOString();
      error.resolvedBy = resolvedBy;
      this.dirty = true;

      logger.info('Error marcado como resuelto', { errorId, resolvedBy });
    }

    return error;
  }

  /**
   * Marcar múltiples errores como resueltos
   * @param {Array<string>} errorIds - IDs de errores
   * @param {string} resolvedBy - Quién los resolvió
   * @returns {number} Cantidad de errores resueltos
   */
  markMultipleResolved(errorIds, resolvedBy = 'bulk') {
    let count = 0;

    for (const errorId of errorIds) {
      const error = this.errors.find(e => e.id === errorId);
      if (error && !error.resolved) {
        error.resolved = true;
        error.resolvedAt = new Date().toISOString();
        error.resolvedBy = resolvedBy;
        count++;
      }
    }

    if (count > 0) {
      this.dirty = true;
      logger.info('Errores marcados como resueltos', { count, resolvedBy });
    }

    return count;
  }

  /**
   * Obtener estadísticas de errores
   * @returns {Object} Estadísticas
   */
  getStats() {
    const now = new Date();
    const last24h = new Date(now - 24 * 60 * 60 * 1000);
    const lastHour = new Date(now - 60 * 60 * 1000);

    const errorsLast24h = this.errors.filter(e => new Date(e.timestamp) >= last24h);
    const errorsLastHour = this.errors.filter(e => new Date(e.timestamp) >= lastHour);

    return {
      total: this.errors.length,
      unresolved: this.errors.filter(e => !e.resolved).length,
      last24h: {
        total: errorsLast24h.length,
        bySeverity: this.groupBy(errorsLast24h, 'severity'),
        byType: this.groupBy(errorsLast24h, 'type')
      },
      lastHour: {
        total: errorsLastHour.length,
        bySeverity: this.groupBy(errorsLastHour, 'severity'),
        byType: this.groupBy(errorsLastHour, 'type')
      }
    };
  }

  /**
   * Agrupar errores por campo
   * @param {Array} arr - Array de errores
   * @param {string} key - Campo por el cual agrupar
   * @returns {Object} Conteo por grupo
   */
  groupBy(arr, key) {
    return arr.reduce((acc, item) => {
      const val = item[key] || 'unknown';
      acc[val] = (acc[val] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Obtener el error más reciente de un tipo
   * @param {string} type - Tipo de error
   * @returns {Object|null} Error más reciente o null
   */
  getLastErrorOfType(type) {
    return this.errors.find(e => e.type === type) || null;
  }

  /**
   * Limpiar errores antiguos
   * @param {number} maxAgeDays - Máximo de días a mantener
   * @returns {number} Cantidad de errores eliminados
   */
  cleanup(maxAgeDays = 30) {
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const before = this.errors.length;

    this.errors = this.errors.filter(e => {
      const timestamp = new Date(e.timestamp).getTime();
      return timestamp >= cutoff;
    });

    const removed = before - this.errors.length;

    if (removed > 0) {
      this.dirty = true;
      logger.info(`Limpiados ${removed} errores antiguos`);
    }

    return removed;
  }

  /**
   * Exportar errores para auditoría
   * @param {Object} filters - Filtros opcionales
   * @returns {Array} Errores formateados para export
   */
  exportForAudit(filters = {}) {
    const errors = this.getErrors(filters);

    return errors.map(e => ({
      id: e.id,
      timestamp: e.timestamp,
      type: e.type,
      severity: e.severity,
      source: e.source,
      message: e.message,
      orderId: e.context?.orderId,
      resolved: e.resolved,
      resolvedAt: e.resolvedAt
    }));
  }

  /**
   * Tamaño del store
   */
  get size() {
    return this.errors.length;
  }
}

// Singleton del store de errores
let errorStore = null;

function getErrorStore() {
  if (!errorStore) {
    errorStore = new ErrorStore();
  }
  return errorStore;
}

module.exports = {
  ErrorStore,
  getErrorStore,
  ERROR_TYPES,
  SEVERITY_LEVELS
};
