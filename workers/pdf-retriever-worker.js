/**
 * Worker para obtenci\u00f3n de PDFs en background
 * Fase 2: Ejecuta peri\u00f3dicamente para obtener PDFs de Biller
 * @module workers/pdf-retriever-worker
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { BillerClient } = require('../biller-client');
const config = require('../config');

class PDFRetrieverWorker {
  constructor(db, store) {
    this.db = db;
    this.store = store; // Para Fase 1, o null si usamos BD
    this.biller = new BillerClient();
    this.isRunning = false;
    this.interval = null;

    // Configuración de reintentos
    this.maxAttempts = parseInt(process.env.PDF_MAX_ATTEMPTS) || 10;
    this.retryDelayMs = parseInt(process.env.PDF_RETRY_DELAY) || 5000;
    this.processInterval = parseInt(process.env.PDF_PROCESS_INTERVAL) || 10000;
  }

  /**
   * Iniciar worker
   */
  start() {
    if (this.isRunning) {
      logger.warn('PDF Retriever Worker ya está corriendo');
      return;
    }

    this.isRunning = true;
    logger.info('Iniciando PDF Retriever Worker', {
      interval: this.processInterval,
      maxAttempts: this.maxAttempts
    });

    // Procesar cada N segundos
    this.interval = setInterval(async () => {
      try {
        await this.processPendingPDFs();
      } catch (error) {
        logger.error('Error en PDF Retriever Worker', { error: error.message });
      }
    }, this.processInterval);

    this.interval.unref(); // No bloquear proceso
  }

  /**
   * Detener worker
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    logger.info('PDF Retriever Worker detenido');
  }

  /**
   * Procesar PDFs pendientes
   */
  async processPendingPDFs() {
    try {
      let pendientes = [];

      // Si tenemos BD (Fase 2)
      if (this.db) {
        // TODO: Implementar con BD
        // pendientes = await this.db.mlInvoices.findPendingPDFs(50);
      } else if (this.store) {
        // Fase 1: Usar store en memoria
        pendientes = this.store.findPDFsPending();
      }

      if (pendientes.length === 0) {
        logger.debug('No hay PDFs pendientes');
        return;
      }

      logger.info('Procesando PDFs pendientes', { cantidad: pendientes.length });

      for (const invoice of pendientes) {
        try {
          // Validar si aún puede reintentar
          const attemptCount = invoice.pdf_attempt_count || 0;

          if (attemptCount >= this.maxAttempts) {
            await this.markPDFAsError(invoice, 'Máximo de intentos alcanzado');
            continue;
          }

          // Intentar obtener
          await this.retrievePDF(invoice);

        } catch (error) {
          logger.error('Error procesando PDF', {
            invoiceId: invoice.ml_order_id,
            error: error.message
          });
        }

        // Pequeño delay entre intentos
        await this.delay(100);
      }

    } catch (error) {
      logger.error('Error en processPendingPDFs', { error: error.message });
    }
  }

  /**
   * Obtener un PDF específico
   */
  async retrievePDF(invoice) {
    const operationId = `pdf-${invoice.ml_order_id}-${Date.now()}`;
    const op = logger.startOperation(operationId, `Obtener PDF ${invoice.ml_order_id}`);

    const billerId = invoice.biller_request_id || invoice.id;

    try {
      logger.debug('Intentando obtener PDF', {
        billerId,
        attemptNum: (invoice.pdf_attempt_count || 0) + 1
      });

      // 1. Intentar obtener PDF de Biller
      let pdf;
      try {
        pdf = await this.biller.obtenerPDF(billerId, { operationId });
      } catch (error) {
        // Si PDF aún no está listo (404), reintentar después
        if (error.code === 'PDF_NOT_READY') {
          logger.debug('PDF no está listo aún', {
            billerId,
            attemptNum: (invoice.pdf_attempt_count || 0) + 1
          });

          await this.updateAttempt(invoice, false, 'Aún no generado por Biller');
          op.end({ status: 'not_ready' });
          return;
        }

        // Otro error
        throw error;
      }

      // 2. Almacenar PDF
      const pdfUrl = await this.storePDF(pdf, invoice);

      // 3. Actualizar estado en store/BD
      await this.updatePDFSuccess(invoice, pdfUrl);

      op.end({ size: `${(pdf.length / 1024).toFixed(2)}KB`, url: pdfUrl });

      logger.info('PDF obtenido y almacenado exitosamente', {
        billerId,
        size: `${(pdf.length / 1024).toFixed(2)}KB`,
        url: pdfUrl
      });

    } catch (error) {
      logger.error('Error obteniendo PDF', {
        billerId,
        error: error.message
      });

      await this.updateAttempt(invoice, false, error.message);
      op.fail(error);
    }
  }

  /**
   * Almacenar PDF (Fase 1: filesystem, Fase 2: S3)
   */
  async storePDF(pdfBuffer, invoice) {
    // OPCIÓN A: Almacenamiento local
    if (process.env.PDF_STORAGE === 'filesystem' || !process.env.PDF_STORAGE) {
      return await this.storePDFLocal(pdfBuffer, invoice);
    }

    // OPCIÓN B: S3 (pendiente implementación)
    if (process.env.PDF_STORAGE === 's3') {
      throw new Error('S3 storage no implementado aún');
    }

    throw new Error(`Storage no soportado: ${process.env.PDF_STORAGE}`);
  }

  /**
   * Almacenar PDF en filesystem
   */
  async storePDFLocal(pdfBuffer, invoice) {
    try {
      // Crear directorio si no existe
      const pdfDir = path.join(
        process.env.PDF_STORAGE_PATH || './data/pdfs',
        new Date().toISOString().split('T')[0] // Por día
      );

      if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true });
      }

      // Nombre: invoiceId_billerId_timestamp.pdf
      const filename = `${invoice.ml_order_id}_${invoice.biller_request_id}_${Date.now()}.pdf`;
      const filepath = path.join(pdfDir, filename);

      // Escribir archivo
      fs.writeFileSync(filepath, pdfBuffer);

      logger.debug('PDF guardado en filesystem', {
        path: filepath,
        size: `${(pdfBuffer.length / 1024).toFixed(2)}KB`
      });

      // Retornar URL pública
      const pdfUrl = `${config.server.publicUrl}/api/pdfs/${new Date().toISOString().split('T')[0]}/${filename}`;
      return pdfUrl;

    } catch (error) {
      logger.error('Error almacenando PDF en filesystem', { error: error.message });
      throw error;
    }
  }

  /**
   * Actualizar estado después de éxito
   */
  async updatePDFSuccess(invoice, pdfUrl) {
    if (this.store) {
      // Fase 1
      this.store.updatePDFStatus(invoice.key || `ml-${invoice.ml_order_id}`, {
        pdf_status: 'ready',
        pdf_url: pdfUrl,
        pdf_retrieved_at: new Date().toISOString(),
        pdf_attempt_count: (invoice.pdf_attempt_count || 0) + 1
      });
    } else if (this.db) {
      // Fase 2
      // TODO: Actualizar en BD
      // await this.db.mlInvoices.updatePDFStatus(invoice.ml_order_id, 'ready', { ... });
    }
  }

  /**
   * Actualizar intento fallido
   */
  async updateAttempt(invoice, success, errorMsg) {
    const nextAttemptCount = (invoice.pdf_attempt_count || 0) + 1;

    if (this.store) {
      // Fase 1
      this.store.updatePDFStatus(invoice.key || `ml-${invoice.ml_order_id}`, {
        pdf_status: success ? 'ready' : 'pending',
        pdf_attempt_count: nextAttemptCount,
        pdf_last_attempt_at: new Date().toISOString(),
        pdf_error_message: errorMsg
      });
    } else if (this.db) {
      // Fase 2
      // TODO: Actualizar en BD
    }
  }

  /**
   * Marcar PDF como error
   */
  async markPDFAsError(invoice, errorMsg) {
    logger.warn('Marcando PDF como error después de máx intentos', {
      invoiceId: invoice.ml_order_id,
      attempts: invoice.pdf_attempt_count
    });

    if (this.store) {
      this.store.updatePDFStatus(invoice.key || `ml-${invoice.ml_order_id}`, {
        pdf_status: 'error',
        pdf_error_message: errorMsg
      });
    } else if (this.db) {
      // Fase 2: Actualizar en BD
    }
  }

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Crear y exportar instancia singleton
 */
let workerInstance = null;

function getPDFRetrieverWorker(db, store) {
  if (!workerInstance) {
    workerInstance = new PDFRetrieverWorker(db, store);
  }
  return workerInstance;
}

module.exports = {
  PDFRetrieverWorker,
  getPDFRetrieverWorker
};
