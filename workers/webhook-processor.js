/**
 * Worker para re-procesar webhooks pendientes
 * Consume la cola persistente de webhooks y re-intenta los fallidos
 * @module workers/webhook-processor
 */

const logger = require('../utils/logger');
const { getWebhookQueue } = require('../utils/webhook-queue');
const config = require('../config');

class WebhookProcessorWorker {
    constructor(processors) {
        this.processors = processors; // { orders_v2: fn, claims: fn }
        this.queue = getWebhookQueue();
        this.isRunning = false;
        this.interval = null;
        this.processInterval = config.webhookProcessor?.interval || 60000; // 1 minuto
    }

    /**
     * Iniciar worker
     */
    start() {
        if (this.isRunning) {
            logger.warn('Webhook Processor ya está corriendo');
            return;
        }

        this.isRunning = true;
        logger.info('🔄 Iniciando Webhook Processor Worker', {
            interval: this.processInterval
        });

        // Procesar pendientes al iniciar
        this.processPending();

        // Luego periódicamente
        this.interval = setInterval(() => {
            this.processPending();
        }, this.processInterval);

        this.interval.unref();
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
        logger.info('🔄 Webhook Processor Worker detenido');
    }

    /**
     * Procesar webhooks pendientes de la cola
     */
    async processPending() {
        const stats = this.queue.getStats();

        if (stats.pending === 0) {
            return;
        }

        logger.info('🔄 Procesando webhooks pendientes', { pending: stats.pending });

        let processed = 0;
        let failed = 0;

        // Procesar hasta 10 items por ciclo
        for (let i = 0; i < 10; i++) {
            const item = this.queue.getNext();
            if (!item) break;

            try {
                await this.processItem(item);
                this.queue.complete(item.id);
                processed++;
            } catch (error) {
                logger.error('Error procesando webhook de cola', {
                    id: item.id,
                    topic: item.topic,
                    error: error.message,
                    retries: item.retries
                });
                this.queue.fail(item.id, error.message);
                failed++;
            }

            // Pequeño delay entre items
            await this.delay(100);
        }

        if (processed > 0 || failed > 0) {
            logger.info('🔄 Ciclo de procesamiento completado', { processed, failed });
        }
    }

    /**
     * Procesar un item individual
     * @param {Object} item 
     */
    async processItem(item) {
        const processor = this.processors[item.topic];

        if (!processor) {
            logger.debug('Sin procesador para topic', { topic: item.topic });
            return;
        }

        logger.debug('Procesando webhook de cola', {
            id: item.id,
            topic: item.topic,
            resourceId: item.resourceId,
            retries: item.retries
        });

        await processor(item.resourceId);
    }

    /**
     * Delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Obtener estadísticas
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            queue: this.queue.getStats(),
            deadLetters: this.queue.getDeadLetters().length
        };
    }
}

module.exports = { WebhookProcessorWorker };
