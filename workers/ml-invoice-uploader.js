/**
 * Worker para subir PDFs de comprobantes a MercadoLibre
 * Permite que el comprador vea la factura en su historial de compras
 * @module workers/ml-invoice-uploader
 */

const FormData = require('form-data');
const config = require('../config');
const logger = require('../utils/logger');
const { getComprobanteStore } = require('../utils/store');

class MLInvoiceUploaderWorker {
    constructor(billerClient) {
        this.biller = billerClient;
        this.store = getComprobanteStore();
        this.isRunning = false;
        this.interval = null;
        this.processInterval = config.mlInvoiceUpload?.processInterval || 30000;
        this.maxAttempts = config.mlInvoiceUpload?.maxAttempts || 5;
    }

    /**
     * Iniciar el worker
     */
    start() {
        if (!config.mlInvoiceUpload?.enabled) {
            logger.info('📤 ML Invoice Uploader deshabilitado');
            return;
        }

        if (this.isRunning) {
            logger.warn('📤 ML Invoice Uploader ya está corriendo');
            return;
        }

        this.isRunning = true;
        logger.info('📤 Iniciando ML Invoice Uploader Worker', {
            interval: this.processInterval,
            maxAttempts: this.maxAttempts
        });

        // Ejecutar inmediatamente una vez
        this.processQueue();

        // Luego ejecutar periódicamente
        this.interval = setInterval(async () => {
            await this.processQueue();
        }, this.processInterval);

        this.interval.unref();
    }

    /**
     * Detener el worker
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
        logger.info('📤 ML Invoice Uploader Worker detenido');
    }

    /**
     * Procesar cola de PDFs pendientes de subir a ML
     */
    async processQueue() {
        try {
            const pendientes = this.store.findPendingMLUpload?.() || [];

            if (pendientes.length === 0) {
                return;
            }

            logger.debug('📤 PDFs pendientes de subir a ML', { cantidad: pendientes.length });

            for (const comp of pendientes) {
                try {
                    await this.uploadToML(comp);
                } catch (error) {
                    logger.error('Error subiendo a ML', {
                        orderId: comp.ml_order_id || comp.order_id,
                        error: error.message
                    });
                }
            }
        } catch (error) {
            logger.error('Error en ML Invoice Uploader', { error: error.message });
        }
    }

    /**
     * Subir un comprobante a MercadoLibre
     * @param {Object} comp - Datos del comprobante
     */
    async uploadToML(comp) {
        const orderId = comp.ml_order_id || comp.order_id;

        if (!orderId) {
            logger.warn('Comprobante sin order_id', { id: comp.id });
            return;
        }

        try {
            // 1. Obtener PDF de Biller (devuelve ArrayBuffer)
            const pdfArrayBuffer = await this.biller.obtenerPDF(comp.id);

            if (!pdfArrayBuffer || pdfArrayBuffer.byteLength === 0) {
                throw new Error('PDF no disponible en Biller');
            }

            // Convertir ArrayBuffer a Buffer para FormData
            const pdfBuffer = Buffer.from(pdfArrayBuffer);

            // 2. Obtener pack_id de la orden
            const packId = await this.getPackId(orderId);

            // 3. Subir a MercadoLibre
            await this.subirFactura(packId, pdfBuffer, `comprobante-${comp.serie}-${comp.numero}.pdf`);

            // 4. Marcar como subido
            this.store.markMLUploaded(orderId);

            logger.info('✅ Factura subida a MercadoLibre', {
                orderId,
                packId,
                comprobante: `${comp.serie}-${comp.numero}`
            });

            // 5. Opcionalmente agregar nota
            if (config.mlInvoiceUpload?.agregarNota && comp.pdf_url) {
                await this.agregarNota(orderId, comp.pdf_url);
            }

        } catch (error) {
            this.store.incrementMLUploadAttempt(orderId);

            if (error.message?.includes('already_exists')) {
                // Ya existe, marcar como subido
                this.store.markMLUploaded(orderId);
                logger.info('Factura ya existe en ML', { orderId });
            } else {
                throw error;
            }
        }
    }

    /**
     * Obtener pack_id de una orden
     * @param {string} orderId 
     * @returns {string} pack_id o order_id
     */
    async getPackId(orderId) {
        try {
            // Usar TokenManager (lazy require para evitar ciclos)
            const { getTokenManager } = require('../utils/token-manager');
            const accessToken = await getTokenManager().ensureValidToken();

            const response = await fetch(
                `https://api.mercadolibre.com/orders/${orderId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Accept': 'application/json'
                    }
                }
            );

            if (!response.ok) {
                return orderId;
            }

            const orden = await response.json();
            return orden.pack_id || orderId;

        } catch (error) {
            logger.debug('Error obteniendo pack_id', { orderId, error: error.message });
            return orderId;
        }
    }

    async subirFactura(packId, pdfBuffer, filename) {
        const MAX_SIZE = 1024 * 1024;
        if (pdfBuffer.length > MAX_SIZE) {
            throw new Error(`PDF excede 1MB (${(pdfBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
        }

        const formData = new FormData();
        formData.append('fiscal_document', pdfBuffer, {
            filename: filename,
            contentType: 'application/pdf'
        });

        const { getTokenManager } = require('../utils/token-manager');
        const accessToken = await getTokenManager().ensureValidToken();

        const response = await fetch(
            `https://api.mercadolibre.com/packs/${packId}/fiscal_documents`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    ...formData.getHeaders()
                },
                body: formData
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error ${response.status}: ${errorText}`);
        }

        return await response.json();
    }

    async agregarNota(orderId, pdfUrl) {
        try {
            const nota = `📄 Tu comprobante electrónico: ${pdfUrl}`;

            const { getTokenManager } = require('../utils/token-manager');
            const accessToken = await getTokenManager().ensureValidToken();

            await fetch(
                `https://api.mercadolibre.com/orders/${orderId}/notes`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ note: nota.substring(0, 300) })
                }
            );

            logger.debug('Nota agregada a orden', { orderId });
        } catch (error) {
            logger.debug('Error agregando nota', { orderId, error: error.message });
        }
    }
}

module.exports = { MLInvoiceUploaderWorker };
