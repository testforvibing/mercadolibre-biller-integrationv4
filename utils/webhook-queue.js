/**
 * Cola persistente de webhooks
 * Garantiza que ningún webhook se pierda si el servidor se reinicia
 * @module utils/webhook-queue
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class PersistentWebhookQueue {
    constructor(filePath = './data/webhook-queue.json') {
        this.filePath = filePath;
        this.queue = [];
        this.processing = new Set();
        this.maxRetries = 5;

        this.load();
    }

    /**
     * Cargar cola desde disco
     */
    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = fs.readFileSync(this.filePath, 'utf8');
                const parsed = JSON.parse(data);
                this.queue = parsed.queue || [];

                // Resetear items que estaban processing (servidor reiniciado)
                this.queue.forEach(item => {
                    if (item.status === 'processing') {
                        item.status = 'pending';
                        item.retries = (item.retries || 0);
                    }
                });

                logger.info('Webhook queue cargada', {
                    pending: this.queue.filter(i => i.status === 'pending').length
                });
            }
        } catch (error) {
            logger.warn('Error cargando webhook queue', { error: error.message });
            this.queue = [];
        }
    }

    /**
     * Guardar cola a disco
     */
    save() {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(
                this.filePath,
                JSON.stringify({ queue: this.queue, savedAt: new Date().toISOString() }, null, 2)
            );
        } catch (error) {
            logger.error('Error guardando webhook queue', { error: error.message });
        }
    }

    /**
     * Agregar webhook a la cola
     * @param {Object} webhook - Datos del webhook
     * @returns {string} ID del item en cola
     */
    async add(webhook) {
        const id = `wh-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const item = {
            id,
            topic: webhook.topic,
            resource: webhook.resource,
            resourceId: webhook.resource?.split('/').pop(),
            userId: webhook.user_id,
            status: 'pending',
            retries: 0,
            createdAt: new Date().toISOString(),
            lastAttempt: null,
            error: null
        };

        this.queue.push(item);
        this.save();

        logger.debug('Webhook encolado', { id, topic: webhook.topic });
        return id;
    }

    /**
     * Obtener siguiente item pendiente
     * @returns {Object|null}
     */
    getNext() {
        const item = this.queue.find(i =>
            i.status === 'pending' &&
            i.retries < this.maxRetries &&
            !this.processing.has(i.id)
        );

        if (item) {
            item.status = 'processing';
            this.processing.add(item.id);
            this.save();
        }

        return item || null;
    }

    /**
     * Marcar item como completado
     * @param {string} id 
     */
    complete(id) {
        const index = this.queue.findIndex(i => i.id === id);
        if (index !== -1) {
            this.queue.splice(index, 1);
            this.processing.delete(id);
            this.save();
            logger.debug('Webhook completado', { id });
        }
    }

    /**
     * Marcar item como fallido (para reintento)
     * @param {string} id 
     * @param {string} error 
     */
    fail(id, error) {
        const item = this.queue.find(i => i.id === id);
        if (item) {
            item.status = 'pending';
            item.retries++;
            item.lastAttempt = new Date().toISOString();
            item.error = error;
            this.processing.delete(id);

            if (item.retries >= this.maxRetries) {
                item.status = 'dead';
                logger.error('Webhook movido a dead letter', { id, retries: item.retries, error });
            }

            this.save();
        }
    }

    /**
     * Obtener estadísticas
     */
    getStats() {
        return {
            total: this.queue.length,
            pending: this.queue.filter(i => i.status === 'pending').length,
            processing: this.processing.size,
            dead: this.queue.filter(i => i.status === 'dead').length
        };
    }

    /**
     * Obtener items en dead letter queue
     */
    getDeadLetters() {
        return this.queue.filter(i => i.status === 'dead');
    }

    /**
     * Limpiar items completados antiguos
     */
    cleanup(maxAgeDays = 7) {
        const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
        const before = this.queue.length;

        this.queue = this.queue.filter(i =>
            i.status !== 'dead' || new Date(i.createdAt).getTime() > cutoff
        );

        if (this.queue.length < before) {
            this.save();
            logger.info('Webhook queue cleanup', { removed: before - this.queue.length });
        }
    }
}

// Singleton
let queueInstance = null;

function getWebhookQueue() {
    if (!queueInstance) {
        queueInstance = new PersistentWebhookQueue();
    }
    return queueInstance;
}

module.exports = {
    PersistentWebhookQueue,
    getWebhookQueue
};
