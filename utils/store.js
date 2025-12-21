/**
 * Sistema de persistencia para comprobantes
 * Guarda en archivo JSON con auto-save
 * @module utils/store
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const config = require('../config');

class ComprobanteStore {
  constructor(filePath) {
    this.filePath = filePath || config.storage.comprobantesFile;
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

        // Convertir objeto a Map
        if (parsed.comprobantes) {
          for (const [key, value] of Object.entries(parsed.comprobantes)) {
            this.data.set(key, value);
          }
        }

        logger.info(`Cargados ${this.data.size} comprobantes desde storage`);
      }
    } catch (error) {
      logger.error('Error cargando comprobantes', { error: error.message });
      // Continuar con Map vacío
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
        comprobantes: Object.fromEntries(this.data)
      };

      // Escribir a archivo temporal primero (atomic write)
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(obj, null, 2));
      fs.renameSync(tempPath, this.filePath);

      // FIX: Marcar dirty=false SOLO después de confirmar escritura exitosa
      this.dirty = false;
      logger.debug('Comprobantes guardados', { total: this.data.size });
    } catch (error) {
      // FIX: NO marcar dirty=false si falla - se reintentará en próximo auto-save
      logger.error('Error guardando comprobantes, se reintentará', { error: error.message });
    }
  }

  /**
   * Iniciar auto-save periódico
   */
  startAutoSave() {
    const interval = (config.storage.autoSaveInterval || 30) * 1000;

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
    // Guardar una última vez
    this.save();
  }

  /**
   * Guardar comprobante emitido
   * @param {string} orderId - ID del pedido Wix
   * @param {Object} comprobante - Datos del comprobante
   */
  set(orderId, comprobante) {
    const key = `wix-${orderId}`;

    const entry = {
      ...comprobante,
      created_at: new Date().toISOString(),
      order_id: orderId
    };

    this.data.set(key, entry);
    this.dirty = true;

    logger.debug('Comprobante guardado en store', { key, tipo: comprobante.tipo_comprobante });

    return entry;
  }

  /**
   * Obtener comprobante por ID de pedido Wix
   * @param {string} orderId
   */
  get(orderId) {
    // Intentar primero con prefijo wix-
    let key = `wix-${orderId}`;
    let result = this.data.get(key);
    if (result) return result;

    // Buscar sin prefijo (por si se pasó key directo)
    return this.data.get(orderId) || null;
  }

  /**
   * Obtener comprobante por key completo
   * @param {string} key
   */
  getByKey(key) {
    return this.data.get(key) || null;
  }

  /**
   * Verificar si existe comprobante para un pedido Wix
   * @param {string} orderId
   */
  has(orderId) {
    return this.data.has(`wix-${orderId}`) || this.data.has(orderId);
  }

  /**
   * Obtener todos los comprobantes
   */
  getAll() {
    return Array.from(this.data.entries()).map(([key, value]) => ({
      key,
      ...value
    }));
  }

  /**
   * Buscar comprobantes por filtro
   * @param {Function} filterFn - Función de filtro
   */
  find(filterFn) {
    return this.getAll().filter(filterFn);
  }

  /**
   * Obtener estadísticas
   */
  getStats() {
    const all = this.getAll();

    const byTipo = {};
    const byFecha = {};

    for (const comp of all) {
      // Por tipo
      const tipo = comp.tipo_comprobante;
      byTipo[tipo] = (byTipo[tipo] || 0) + 1;

      // Por fecha (día)
      const fecha = comp.created_at?.split('T')[0];
      if (fecha) {
        byFecha[fecha] = (byFecha[fecha] || 0) + 1;
      }
    }

    return {
      total: all.length,
      byTipo,
      byFecha,
      eTickets: byTipo[101] || 0,
      eFacturas: byTipo[111] || 0,
      ncETickets: byTipo[102] || 0,
      ncEFacturas: byTipo[112] || 0
    };
  }

  /**
   * Limpiar comprobantes antiguos
   * @param {number} maxAgeDays - Máximo de días a mantener
   */
  cleanup(maxAgeDays = 90) {
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    let removed = 0;

    for (const [key, value] of this.data) {
      const createdAt = new Date(value.created_at).getTime();
      if (createdAt < cutoff) {
        this.data.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.dirty = true;
      logger.info(`Limpiados ${removed} comprobantes antiguos`);
    }

    return removed;
  }

  /**
   * Tamaño del store
   */
  get size() {
    return this.data.size;
  }

  // ========================================================================
  // FASE 1: Métodos para tracking de PDF
  // ========================================================================

  /**
   * Encontrar comprobantes con PDF pendiente
   * @returns {Array} Comprobantes con pdf_status === 'pending'
   */
  findPDFsPending() {
    const all = this.getAll();
    return all.filter(comp => comp.pdf_status === 'pending' && comp.pdf_attempt_count < 10);
  }

  /**
   * Actualizar estado del PDF de un comprobante
   * @param {string|number} billerId - ID del comprobante en Biller
   * @param {string} status - 'pending', 'ready', 'error'
   * @param {string} pdfUrl - URL del PDF (si está ready)
   * @param {string} errorMessage - Mensaje de error (si está error)
   * @param {number} attemptCount - Número de intentos
   */
  updatePDFStatus(billerId, status, pdfUrl = null, errorMessage = null, attemptCount = 0) {
    // Buscar por ID de Biller
    let found = false;

    for (const [key, value] of this.data) {
      if (value.id === billerId || value.id === parseInt(billerId)) {
        value.pdf_status = status;
        value.pdf_url = pdfUrl;
        value.pdf_error_message = errorMessage;
        value.pdf_attempt_count = attemptCount;
        value.pdf_last_attempt_at = new Date().toISOString();
        this.dirty = true;
        found = true;
        logger.debug('PDF status actualizado', {
          billerId,
          status,
          attemptCount
        });
        break;
      }
    }

    if (!found) {
      logger.warn('No se encontró comprobante para actualizar PDF', { billerId });
    }
  }

  /**
   * Buscar comprobante por numero_interno (para idempotencia)
   * @param {string} numeroInterno
   * @returns {Object|null}
   */
  findByNumeroInterno(numeroInterno) {
    const all = this.getAll();
    return all.find(comp => comp.numero_interno === numeroInterno) || null;
  }

  /**
   * Exportar datos para auditoría
   * @returns {Array} Todos los comprobantes con metadatos
   */
  exportForAudit() {
    const all = this.getAll();
    return all.map(comp => ({
      key: comp.key,
      billerId: comp.id,
      numero: `${comp.serie}-${comp.numero}`,
      numeroInterno: comp.numero_interno,
      tipo: comp.tipo_comprobante,
      estado: comp.pdf_status,
      intentos: comp.pdf_attempt_count,
      emision: comp.emision_timestamp,
      creacion: comp.created_at,
      error: comp.pdf_error_message
    }));
  }

  // ========================================================================
  // MÉTODOS PARA NOTAS DE CRÉDITO
  // ========================================================================

  /**
   * Buscar Nota de Crédito por order ID
   * @param {string} orderId
   * @returns {Object|null}
   */
  findNCByOrderId(orderId) {
    const key = `nc-wix-${orderId}`;
    return this.data.get(key) || null;
  }

  /**
   * Guardar Nota de Crédito relacionada a una orden
   * @param {string} orderId
   * @param {Object} nc - Datos de la NC
   */
  addNC(orderId, nc) {
    const key = `nc-wix-${orderId}`;
    const entry = {
      ...nc,
      order_id: orderId,
      is_credit_note: true,
      created_at: new Date().toISOString()
    };

    this.data.set(key, entry);
    this.dirty = true;

    logger.info('NC guardada en store', { key, tipo: nc.tipo_comprobante });
    return entry;
  }

  /**
   * Listar todas las Notas de Crédito
   * @returns {Array}
   */
  listNC() {
    return this.getAll().filter(comp => comp.is_credit_note === true);
  }

  /**
   * Buscar comprobante por order ID (Wix)
   * @param {string} orderId
   * @returns {Object|null}
   */
  findByOrderId(orderId) {
    // Intentar con prefijo wix-
    const key = `wix-${orderId}`;
    return this.data.get(key) || null;
  }
}

// Store para webhooks procesados (en memoria, no persistente)
class WebhookDedupeStore {
  constructor(windowMs = 5 * 60 * 1000) {
    this.processed = new Map();
    this.inProgress = new Set();
    this.windowMs = windowMs;

    // Limpiar periódicamente
    setInterval(() => this.cleanup(), 60 * 1000).unref();
  }

  /**
   * Intentar adquirir lock para procesar webhook
   * @param {string} topic
   * @param {string} resourceId
   * @returns {boolean} - true si se puede procesar
   */
  tryAcquire(topic, resourceId) {
    const key = `${topic}:${resourceId}`;

    // Ya en proceso
    if (this.inProgress.has(key)) {
      return false;
    }

    // Ya procesado recientemente
    if (this.processed.has(key)) {
      return false;
    }

    // Marcar como en proceso
    this.inProgress.add(key);
    return true;
  }

  /**
   * Marcar webhook como completado
   * @param {string} topic
   * @param {string} resourceId
   */
  complete(topic, resourceId) {
    const key = `${topic}:${resourceId}`;
    this.inProgress.delete(key);
    this.processed.set(key, Date.now());
  }

  /**
   * Liberar lock sin marcar como completado
   * @param {string} topic
   * @param {string} resourceId
   */
  release(topic, resourceId) {
    const key = `${topic}:${resourceId}`;
    this.inProgress.delete(key);
  }

  /**
   * Limpiar entradas antiguas
   */
  cleanup() {
    const cutoff = Date.now() - this.windowMs;

    for (const [key, timestamp] of this.processed) {
      if (timestamp < cutoff) {
        this.processed.delete(key);
      }
    }
  }
}

// Singleton del store de comprobantes
let comprobanteStore = null;

function getComprobanteStore() {
  if (!comprobanteStore) {
    comprobanteStore = new ComprobanteStore();
  }
  return comprobanteStore;
}

module.exports = {
  ComprobanteStore,
  WebhookDedupeStore,
  getComprobanteStore
};
