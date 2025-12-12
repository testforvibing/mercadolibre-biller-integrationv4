/**
 * Servicio de reconciliación entre MercadoLibre y Biller
 * Detecta discrepancias y genera reportes
 * @module services/reconciliation-service
 */

const logger = require('../utils/logger');

/**
 * Tipos de discrepancia
 */
const DISCREPANCY_TYPES = {
  MISSING_IN_BILLER: 'missing_in_biller',
  MISSING_IN_LOCAL: 'missing_in_local',
  DATA_MISMATCH: 'data_mismatch',
  PDF_MISSING: 'pdf_missing',
  ML_UPLOAD_PENDING: 'ml_upload_pending',
  RECONCILIATION_ERROR: 'reconciliation_error'
};

/**
 * Severidad de discrepancias
 */
const DISCREPANCY_SEVERITY = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFO: 'info'
};

class ReconciliationService {
  /**
   * @param {Object} comprobanteStore - Store de comprobantes
   * @param {Object} billerClient - Cliente de Biller API
   */
  constructor(comprobanteStore, billerClient) {
    this.store = comprobanteStore;
    this.biller = billerClient;
    this.lastReconciliation = null;
    this.discrepancies = [];
    this.isRunning = false;
  }

  /**
   * Ejecutar reconciliación completa
   * @returns {Object} Resultados de la reconciliación
   */
  async runFullReconciliation() {
    if (this.isRunning) {
      return {
        error: 'Reconciliación ya en progreso',
        lastReconciliation: this.lastReconciliation
      };
    }

    this.isRunning = true;
    const results = {
      startedAt: new Date().toISOString(),
      localComprobantes: 0,
      checkedInBiller: 0,
      matched: 0,
      discrepancies: [],
      errors: []
    };

    try {
      logger.info('Iniciando reconciliación completa');

      // 1. Obtener todos los comprobantes locales
      const localComprobantes = this.store.getAll();
      results.localComprobantes = localComprobantes.length;

      // 2. Verificar cada comprobante
      for (const local of localComprobantes) {
        // Ignorar notas de crédito por ahora (se reconcilian aparte)
        if (local.is_credit_note) continue;

        const numeroInterno = local.numero_interno || `ML-${local.order_id}`;

        try {
          // Verificar en Biller
          const billerComp = await this.biller.buscarPorNumeroInterno(numeroInterno);
          results.checkedInBiller++;

          if (!billerComp) {
            // Comprobante existe localmente pero no en Biller
            results.discrepancies.push(this.createDiscrepancy(
              DISCREPANCY_TYPES.MISSING_IN_BILLER,
              local.order_id,
              local,
              null,
              `Comprobante ${numeroInterno} existe localmente pero no se encontró en Biller`,
              DISCREPANCY_SEVERITY.CRITICAL
            ));
          } else {
            // Verificar consistencia de datos
            const mismatches = this.checkDataConsistency(local, billerComp);

            if (mismatches.length > 0) {
              results.discrepancies.push(this.createDiscrepancy(
                DISCREPANCY_TYPES.DATA_MISMATCH,
                local.order_id,
                local,
                billerComp,
                mismatches.join('; '),
                DISCREPANCY_SEVERITY.WARNING
              ));
            } else {
              results.matched++;
            }
          }

          // Verificar estado del PDF
          if (local.pdf_status !== 'ready') {
            results.discrepancies.push(this.createDiscrepancy(
              DISCREPANCY_TYPES.PDF_MISSING,
              local.order_id,
              local,
              null,
              `PDF no disponible (status: ${local.pdf_status}, intentos: ${local.pdf_attempt_count || 0})`,
              DISCREPANCY_SEVERITY.INFO
            ));
          }

          // Verificar subida a MercadoLibre
          if (local.pdf_status === 'ready' && !local.ml_uploaded) {
            results.discrepancies.push(this.createDiscrepancy(
              DISCREPANCY_TYPES.ML_UPLOAD_PENDING,
              local.order_id,
              local,
              null,
              `PDF listo pero no subido a MercadoLibre (intentos: ${local.ml_upload_attempts || 0})`,
              DISCREPANCY_SEVERITY.INFO
            ));
          }

          // Rate limiting - pequeña pausa entre requests
          await this.sleep(100);

        } catch (error) {
          results.errors.push({
            orderId: local.order_id,
            error: error.message
          });

          results.discrepancies.push(this.createDiscrepancy(
            DISCREPANCY_TYPES.RECONCILIATION_ERROR,
            local.order_id,
            local,
            null,
            `Error verificando en Biller: ${error.message}`,
            DISCREPANCY_SEVERITY.WARNING
          ));
        }
      }

      results.completedAt = new Date().toISOString();
      results.duration = new Date(results.completedAt) - new Date(results.startedAt);
      results.durationFormatted = this.formatDuration(results.duration);

      // Guardar resultados
      this.lastReconciliation = results;
      this.discrepancies = results.discrepancies;

      logger.info('Reconciliación completada', {
        total: results.localComprobantes,
        matched: results.matched,
        discrepancies: results.discrepancies.length,
        duration: results.durationFormatted
      });

      return results;

    } catch (error) {
      logger.error('Error en reconciliación', { error: error.message });
      results.error = error.message;
      results.completedAt = new Date().toISOString();
      return results;

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Ejecutar reconciliación rápida (solo últimos N comprobantes)
   * @param {number} limit - Cantidad de comprobantes a verificar
   * @returns {Object} Resultados
   */
  async runQuickReconciliation(limit = 50) {
    if (this.isRunning) {
      return { error: 'Reconciliación ya en progreso' };
    }

    this.isRunning = true;
    const results = {
      type: 'quick',
      limit,
      startedAt: new Date().toISOString(),
      checked: 0,
      matched: 0,
      discrepancies: []
    };

    try {
      const localComprobantes = this.store.getAll()
        .filter(c => !c.is_credit_note)
        .slice(0, limit);

      for (const local of localComprobantes) {
        const numeroInterno = local.numero_interno || `ML-${local.order_id}`;

        try {
          const billerComp = await this.biller.buscarPorNumeroInterno(numeroInterno);
          results.checked++;

          if (!billerComp) {
            results.discrepancies.push(this.createDiscrepancy(
              DISCREPANCY_TYPES.MISSING_IN_BILLER,
              local.order_id,
              local,
              null,
              `No encontrado en Biller`,
              DISCREPANCY_SEVERITY.CRITICAL
            ));
          } else {
            results.matched++;
          }

          await this.sleep(50);
        } catch (error) {
          // Continuar con el siguiente
        }
      }

      results.completedAt = new Date().toISOString();
      return results;

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Crear objeto de discrepancia
   */
  createDiscrepancy(type, orderId, localData, billerData, details, severity) {
    return {
      id: `disc-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      type,
      orderId,
      localData: localData ? {
        id: localData.id,
        serie: localData.serie,
        numero: localData.numero,
        tipo_comprobante: localData.tipo_comprobante,
        numero_interno: localData.numero_interno,
        pdf_status: localData.pdf_status,
        ml_uploaded: localData.ml_uploaded
      } : null,
      billerData: billerData ? {
        id: billerData.id,
        serie: billerData.serie,
        numero: billerData.numero,
        tipo_comprobante: billerData.tipo_comprobante
      } : null,
      details,
      severity,
      detectedAt: new Date().toISOString(),
      status: 'open'
    };
  }

  /**
   * Verificar consistencia de datos entre local y Biller
   * @param {Object} local - Comprobante local
   * @param {Object} biller - Comprobante de Biller
   * @returns {Array<string>} Lista de diferencias encontradas
   */
  checkDataConsistency(local, biller) {
    const mismatches = [];

    // Verificar tipo de comprobante
    if (local.tipo_comprobante && biller.tipo_comprobante &&
        local.tipo_comprobante !== biller.tipo_comprobante) {
      mismatches.push(`Tipo: local=${local.tipo_comprobante}, biller=${biller.tipo_comprobante}`);
    }

    // Verificar serie
    if (local.serie && biller.serie && local.serie !== biller.serie) {
      mismatches.push(`Serie: local=${local.serie}, biller=${biller.serie}`);
    }

    // Verificar número
    const localNumero = String(local.numero);
    const billerNumero = String(biller.numero);
    if (localNumero && billerNumero && localNumero !== billerNumero) {
      mismatches.push(`Número: local=${localNumero}, biller=${billerNumero}`);
    }

    return mismatches;
  }

  /**
   * Obtener discrepancias con filtros
   * @param {Object} filters - Filtros
   * @returns {Array} Discrepancias filtradas
   */
  getDiscrepancies(filters = {}) {
    let result = [...this.discrepancies];

    if (filters.type) {
      result = result.filter(d => d.type === filters.type);
    }

    if (filters.status) {
      result = result.filter(d => d.status === filters.status);
    }

    if (filters.severity) {
      result = result.filter(d => d.severity === filters.severity);
    }

    return result;
  }

  /**
   * Resolver una discrepancia
   * @param {string} discrepancyId - ID de la discrepancia
   * @param {string} resolution - Tipo de resolución
   * @param {string} notes - Notas opcionales
   * @returns {Object|null} Discrepancia actualizada
   */
  resolveDiscrepancy(discrepancyId, resolution, notes = '') {
    const disc = this.discrepancies.find(d => d.id === discrepancyId);

    if (disc) {
      disc.status = resolution === 'ignore' ? 'ignored' : 'resolved';
      disc.resolvedAt = new Date().toISOString();
      disc.resolution = resolution;
      disc.resolutionNotes = notes;

      logger.info('Discrepancia resuelta', { discrepancyId, resolution });
    }

    return disc;
  }

  /**
   * Obtener resumen de última reconciliación
   * @returns {Object|null}
   */
  getLastReconciliationSummary() {
    if (!this.lastReconciliation) {
      return null;
    }

    return {
      startedAt: this.lastReconciliation.startedAt,
      completedAt: this.lastReconciliation.completedAt,
      duration: this.lastReconciliation.durationFormatted,
      localComprobantes: this.lastReconciliation.localComprobantes,
      checkedInBiller: this.lastReconciliation.checkedInBiller,
      matched: this.lastReconciliation.matched,
      discrepanciesCount: this.lastReconciliation.discrepancies.length,
      discrepanciesBySeverity: this.groupBySeverity(this.lastReconciliation.discrepancies),
      discrepanciesByType: this.groupByType(this.lastReconciliation.discrepancies)
    };
  }

  /**
   * Obtener estadísticas de discrepancias
   * @returns {Object}
   */
  getDiscrepancyStats() {
    const open = this.discrepancies.filter(d => d.status === 'open');

    return {
      total: this.discrepancies.length,
      open: open.length,
      resolved: this.discrepancies.filter(d => d.status === 'resolved').length,
      ignored: this.discrepancies.filter(d => d.status === 'ignored').length,
      bySeverity: this.groupBySeverity(open),
      byType: this.groupByType(open)
    };
  }

  /**
   * Agrupar por severidad
   */
  groupBySeverity(discrepancies) {
    return discrepancies.reduce((acc, d) => {
      acc[d.severity] = (acc[d.severity] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Agrupar por tipo
   */
  groupByType(discrepancies) {
    return discrepancies.reduce((acc, d) => {
      acc[d.type] = (acc[d.type] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Formatear duración en formato legible
   * @param {number} ms - Milisegundos
   * @returns {string}
   */
  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }

  /**
   * Sleep helper
   * @param {number} ms - Milisegundos
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Verificar si hay reconciliación en progreso
   * @returns {boolean}
   */
  isReconciliationRunning() {
    return this.isRunning;
  }
}

// Singleton
let reconciliationService = null;

function getReconciliationService(comprobanteStore, billerClient) {
  if (!reconciliationService && comprobanteStore && billerClient) {
    reconciliationService = new ReconciliationService(comprobanteStore, billerClient);
  }
  return reconciliationService;
}

module.exports = {
  ReconciliationService,
  getReconciliationService,
  DISCREPANCY_TYPES,
  DISCREPANCY_SEVERITY
};
