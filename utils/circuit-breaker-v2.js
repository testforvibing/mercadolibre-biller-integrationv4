/**
 * Circuit Breaker para proteger llamadas a APIs externas
 * Evita sobrecarga cuando un servicio está caído
 * @module utils/circuit-breaker-v2
 */

const logger = require('./logger');

/**
 * Estados del circuit breaker
 */
const STATES = {
    CLOSED: 'CLOSED',       // Normal, permite llamadas
    OPEN: 'OPEN',           // Bloqueado, rechaza llamadas
    HALF_OPEN: 'HALF_OPEN'  // Probando si se recuperó
};

class CircuitBreaker {
    /**
     * @param {string} name - Nombre del circuito (para logs)
     * @param {Object} options - Opciones
     * @param {number} options.failureThreshold - Fallos para abrir (default: 5)
     * @param {number} options.successThreshold - Éxitos para cerrar en half-open (default: 2)
     * @param {number} options.timeout - Tiempo de reset en ms (default: 30000)
     * @param {Function} options.fallback - Función fallback opcional
     */
    constructor(name, options = {}) {
        this.name = name;
        this.state = STATES.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.nextAttempt = null;

        // Configuración
        this.failureThreshold = options.failureThreshold || 5;
        this.successThreshold = options.successThreshold || 2;
        this.timeout = options.timeout || 30000;
        this.fallback = options.fallback || null;

        // Métricas
        this.metrics = {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            rejectedCalls: 0,
            fallbackCalls: 0,
            stateChanges: []
        };
    }

    /**
     * Ejecutar función protegida por circuit breaker
     * @param {Function} fn - Función async a ejecutar
     * @returns {Promise<any>}
     */
    async fire(fn) {
        this.metrics.totalCalls++;

        // Si está abierto, verificar si es tiempo de probar
        if (this.state === STATES.OPEN) {
            if (Date.now() < this.nextAttempt) {
                this.metrics.rejectedCalls++;
                return this.handleRejection();
            }

            // Pasar a half-open
            this.changeState(STATES.HALF_OPEN);
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            return this.onFailure(error);
        }
    }

    /**
     * Manejar éxito
     */
    onSuccess() {
        this.metrics.successfulCalls++;
        this.failureCount = 0;

        if (this.state === STATES.HALF_OPEN) {
            this.successCount++;

            if (this.successCount >= this.successThreshold) {
                this.changeState(STATES.CLOSED);
            }
        }
    }

    /**
     * Manejar fallo
     */
    onFailure(error) {
        this.metrics.failedCalls++;
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.state === STATES.HALF_OPEN) {
            // Volver a abrir
            this.changeState(STATES.OPEN);
        } else if (this.failureCount >= this.failureThreshold) {
            // Abrir circuito
            this.changeState(STATES.OPEN);
        }

        // Si hay fallback, usarlo
        if (this.fallback) {
            this.metrics.fallbackCalls++;
            return this.fallback(error);
        }

        throw error;
    }

    /**
     * Manejar rechazo (circuito abierto)
     */
    handleRejection() {
        if (this.fallback) {
            this.metrics.fallbackCalls++;
            return this.fallback(new Error('Circuit breaker is OPEN'));
        }

        throw new CircuitBreakerError(
            `Circuit breaker "${this.name}" is OPEN. Next attempt at ${new Date(this.nextAttempt).toISOString()}`,
            this.name
        );
    }

    /**
     * Cambiar estado
     */
    changeState(newState) {
        const oldState = this.state;
        this.state = newState;

        if (newState === STATES.OPEN) {
            this.nextAttempt = Date.now() + this.timeout;
            this.successCount = 0;

            logger.warn(`🔴 Circuit breaker "${this.name}" ABIERTO`, {
                failureCount: this.failureCount,
                nextAttempt: new Date(this.nextAttempt).toISOString()
            });
        } else if (newState === STATES.HALF_OPEN) {
            this.successCount = 0;

            logger.info(`🟡 Circuit breaker "${this.name}" HALF-OPEN (probando)`);
        } else if (newState === STATES.CLOSED) {
            this.failureCount = 0;
            this.successCount = 0;

            logger.info(`🟢 Circuit breaker "${this.name}" CERRADO (recuperado)`);
        }

        this.metrics.stateChanges.push({
            from: oldState,
            to: newState,
            timestamp: new Date().toISOString()
        });

        // Mantener solo últimos 10 cambios
        if (this.metrics.stateChanges.length > 10) {
            this.metrics.stateChanges.shift();
        }
    }

    /**
     * Obtener estado actual
     */
    getState() {
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            lastFailureTime: this.lastFailureTime,
            nextAttempt: this.nextAttempt,
            metrics: this.metrics
        };
    }

    /**
     * Forzar reset (para tests o admin)
     */
    reset() {
        this.state = STATES.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.nextAttempt = null;

        logger.info(`Circuit breaker "${this.name}" reseteado manualmente`);
    }

    /**
     * Verificar si está permitiendo llamadas
     */
    isCallAllowed() {
        if (this.state === STATES.CLOSED) return true;
        if (this.state === STATES.HALF_OPEN) return true;
        return Date.now() >= this.nextAttempt;
    }
}

/**
 * Error específico de Circuit Breaker
 */
class CircuitBreakerError extends Error {
    constructor(message, circuitName) {
        super(message);
        this.name = 'CircuitBreakerError';
        this.circuitName = circuitName;
    }
}

/**
 * Wrapper para crear circuit breaker alrededor de una clase
 */
function withCircuitBreaker(instance, methodName, options = {}) {
    const cb = new CircuitBreaker(`${instance.constructor.name}.${methodName}`, options);
    const originalMethod = instance[methodName].bind(instance);

    instance[methodName] = async function (...args) {
        return cb.fire(() => originalMethod(...args));
    };

    // Exponer circuit breaker para monitoreo
    instance[`${methodName}CircuitBreaker`] = cb;

    return cb;
}

module.exports = {
    CircuitBreaker,
    CircuitBreakerError,
    withCircuitBreaker,
    STATES
};
