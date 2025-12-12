/**
 * AuditLogger
 *
 * Sistema de auditoría basado en archivos JSON
 * Persiste eventos de operaciones sin necesidad de BD adicional
 *
 * Fase 2 - Auditoría y trazabilidad completa
 */

const fs = require('fs');
const path = require('path');

class AuditLogger {
  /**
   * Constructor
   * @param {string} dirPath - Directorio donde guardar logs (default: logs/)
   */
  constructor(dirPath = 'logs') {
    this.dirPath = dirPath;
    this.fileName = path.join(dirPath, 'audit.jsonl');
    this.entries = [];
    this.maxEntriesBeforeFlush = 100;
    this.operationLog = new Map(); // Para tracking de operaciones activas

    // Crear directorio si no existe
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Registrar inicio de operación
   * @param {string} operationId - ID único de la operación
   * @param {string} action - Tipo de acción (ej: 'emit_invoice', 'search_biller')
   * @param {object} context - Contexto/metadata
   */
  startOperation(operationId, action, context = {}) {
    this.operationLog.set(operationId, {
      action,
      context,
      startTime: Date.now()
    });
  }

  /**
   * Registrar finalización de operación
   * @param {string} operationId - ID de la operación
   * @param {string} status - 'success' | 'error' | 'skipped'
   * @param {object} result - Resultado de la operación
   * @param {object} error - Error si aplica
   */
  endOperation(operationId, status = 'success', result = {}, error = null) {
    const opData = this.operationLog.get(operationId);

    if (!opData) {
      this.log('operation_end', {
        operation_id: operationId,
        status,
        result,
        error: error?.message || null
      });
      return;
    }

    const duration = Date.now() - opData.startTime;

    this.log('operation', {
      operation_id: operationId,
      action: opData.action,
      status,
      duration_ms: duration,
      context: opData.context,
      result,
      error: error?.message || null
    });

    this.operationLog.delete(operationId);
  }

  /**
   * Registrar evento de auditoría
   * @param {string} event - Tipo de evento
   * @param {object} details - Detalles del evento
   * @param {string} level - 'info' | 'warn' | 'error' | 'debug'
   */
  log(event, details = {}, level = 'info') {
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      level,
      ...details
    };

    this.entries.push(entry);

    // Auto-flush si hemos acumulado suficientes entradas
    if (this.entries.length >= this.maxEntriesBeforeFlush) {
      this.flush();
    }
  }

  /**
   * Registrar búsqueda en Biller
   * @param {string} numeroInterno - Número a buscar
   * @param {boolean} found - Si fue encontrado
   * @param {object} result - Resultado encontrado
   */
  logBillerSearch(numeroInterno, found, result = null) {
    this.log('biller_search', {
      numero_interno: numeroInterno,
      found,
      result: found ? { id: result?.id, numero: result?.numero } : null
    });
  }

  /**
   * Registrar emisión de comprobante
   * @param {string} numeroInterno - Número interno
   * @param {number} billerId - ID en Biller
   * @param {object} metadata - Metadata adicional
   */
  logInvoiceEmitted(numeroInterno, billerId, metadata = {}) {
    this.log('invoice_emitted', {
      numero_interno: numeroInterno,
      biller_id: billerId,
      ...metadata
    });
  }

  /**
   * Registrar intento de obtención de PDF
   * @param {number} billerId - ID en Biller
   * @param {number} attemptNumber - Número de intento
   * @param {boolean} success - Si fue exitoso
   * @param {string} error - Mensaje de error si falló
   */
  logPDFAttempt(billerId, attemptNumber, success, error = null) {
    this.log('pdf_attempt', {
      biller_id: billerId,
      attempt: attemptNumber,
      success,
      error: error || null
    });
  }

  /**
   * Registrar caché hit/miss
   * @param {string} numeroInterno - Lo que se buscó
   * @param {boolean} hit - Si fue cache hit
   */
  logCacheEvent(numeroInterno, hit) {
    this.log('cache_event', {
      numero_interno: numeroInterno,
      type: hit ? 'hit' : 'miss'
    });
  }

  /**
   * Guardar entradas a archivo (flush)
   * Usa JSONL format (una entrada por línea para fácil parsing)
   */
  flush() {
    if (this.entries.length === 0) return;

    try {
      const lines = this.entries
        .map(entry => JSON.stringify(entry))
        .join('\n') + '\n';

      fs.appendFileSync(this.fileName, lines, 'utf8');

      this.entries = [];
    } catch (error) {
      console.error('❌ Error guardando audit log:', error.message);
    }
  }

  /**
   * Obtener últimos N eventos del archivo
   * @param {number} limit - Cuántos eventos obtener
   * @returns {array} Array de eventos
   */
  getTailEntries(limit = 50) {
    try {
      const content = fs.readFileSync(this.fileName, 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      const lastLines = lines.slice(-limit);

      return lastLines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(e => e !== null);
    } catch (error) {
      return [];
    }
  }

  /**
   * Buscar eventos en el log
   * @param {object} criteria - Criterios de búsqueda {event, level, numeroInterno, etc}
   * @returns {array} Eventos que coinciden
   */
  search(criteria = {}) {
    try {
      const content = fs.readFileSync(this.fileName, 'utf8');
      const lines = content.trim().split('\n').filter(l => l);

      const results = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          // Verificar si coincide con criterios
          let matches = true;
          for (const [key, value] of Object.entries(criteria)) {
            if (entry[key] !== value) {
              matches = false;
              break;
            }
          }

          if (matches) {
            results.push(entry);
          }
        } catch {
          // Skip líneas inválidas
        }
      }

      return results;
    } catch (error) {
      return [];
    }
  }

  /**
   * Buscar por rango de tiempo
   * @param {Date} startDate - Fecha inicio
   * @param {Date} endDate - Fecha fin
   * @returns {array} Eventos en rango
   */
  searchByTimeRange(startDate, endDate) {
    try {
      const content = fs.readFileSync(this.fileName, 'utf8');
      const lines = content.trim().split('\n').filter(l => l);

      const start = startDate.getTime();
      const end = endDate.getTime();

      const results = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const ts = new Date(entry.timestamp).getTime();

          if (ts >= start && ts <= end) {
            results.push(entry);
          }
        } catch {
          // Skip
        }
      }

      return results;
    } catch (error) {
      return [];
    }
  }

  /**
   * Obtener estadísticas del log
   * @returns {object} Stats
   */
  getStats() {
    try {
      const content = fs.readFileSync(this.fileName, 'utf8');
      const lines = content.trim().split('\n').filter(l => l);

      const stats = {
        total_entries: lines.length,
        by_event: {},
        by_level: {},
        file_size_kb: fs.statSync(this.fileName).size / 1024
      };

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          stats.by_event[entry.event] = (stats.by_event[entry.event] || 0) + 1;
          stats.by_level[entry.level] = (stats.by_level[entry.level] || 0) + 1;
        } catch {
          // Skip
        }
      }

      return stats;
    } catch (error) {
      return {
        total_entries: 0,
        by_event: {},
        by_level: {},
        file_size_kb: 0
      };
    }
  }

  /**
   * Limpiar log (archivar actual)
   * @returns {string} Nombre del archivo archivado
   */
  rotate() {
    if (!fs.existsSync(this.fileName)) {
      return null;
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const archiveName = path.join(
      this.dirPath,
      `audit.${timestamp}.jsonl`
    );

    fs.renameSync(this.fileName, archiveName);
    return archiveName;
  }
}

module.exports = AuditLogger;
