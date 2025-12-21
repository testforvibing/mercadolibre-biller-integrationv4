/**
 * Métricas Prometheus para monitoreo
 * @module monitoring/prometheus-metrics
 */

const logger = require('../utils/logger');

/**
 * Clase simple de métricas compatible con Prometheus
 * No requiere dependencias externas
 */
class PrometheusMetrics {
    constructor() {
        this.counters = new Map();
        this.gauges = new Map();
        this.histograms = new Map();

        // Métricas predefinidas
        this.defineDefaultMetrics();
    }

    /**
     * Definir métricas por defecto
     */
    defineDefaultMetrics() {
        // Contadores
        this.counter('webhooks_received_total', 'Total de webhooks recibidos');
        this.counter('webhooks_processed_total', 'Total de webhooks procesados exitosamente');
        this.counter('webhooks_failed_total', 'Total de webhooks fallidos');
        this.counter('comprobantes_emitidos_total', 'Total de comprobantes emitidos', ['tipo']);
        this.counter('notas_credito_emitidas_total', 'Total de notas de crédito emitidas');
        this.counter('pdf_uploads_total', 'Total de PDFs subidos a ML', ['status']);
        this.counter('biller_requests_total', 'Total de requests a Biller API', ['method', 'status']);
        this.counter('ml_requests_total', 'Total de requests a ML API', ['method', 'status']);

        // Gauges
        this.gauge('webhooks_queue_pending', 'Webhooks pendientes en cola');
        this.gauge('webhooks_queue_dead', 'Webhooks en dead letter queue');
        this.gauge('uptime_seconds', 'Tiempo de uptime en segundos');

        // Histograms
        this.histogram('biller_request_duration_seconds', 'Duración de requests a Biller');
        this.histogram('ml_request_duration_seconds', 'Duración de requests a ML');
        this.histogram('webhook_processing_duration_seconds', 'Duración de procesamiento de webhooks');
    }

    /**
     * Crear contador
     */
    counter(name, help, labels = []) {
        this.counters.set(name, {
            name,
            help,
            labels,
            values: new Map()
        });
        return this;
    }

    /**
     * Incrementar contador
     */
    inc(name, labels = {}, value = 1) {
        const counter = this.counters.get(name);
        if (!counter) return;

        const key = this.labelsToKey(labels);
        const current = counter.values.get(key) || 0;
        counter.values.set(key, current + value);
    }

    /**
     * Crear gauge
     */
    gauge(name, help) {
        this.gauges.set(name, {
            name,
            help,
            value: 0
        });
        return this;
    }

    /**
     * Setear gauge
     */
    set(name, value) {
        const gauge = this.gauges.get(name);
        if (!gauge) return;
        gauge.value = value;
    }

    /**
     * Crear histogram
     */
    histogram(name, help, buckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
        this.histograms.set(name, {
            name,
            help,
            buckets,
            values: [],
            sum: 0,
            count: 0
        });
        return this;
    }

    /**
     * Observar valor en histogram
     */
    observe(name, value) {
        const histogram = this.histograms.get(name);
        if (!histogram) return;

        histogram.values.push(value);
        histogram.sum += value;
        histogram.count++;

        // Mantener solo últimos 1000 valores
        if (histogram.values.length > 1000) {
            histogram.values.shift();
        }
    }

    /**
     * Timer helper para histograms
     */
    startTimer(name) {
        const start = process.hrtime.bigint();
        return () => {
            const end = process.hrtime.bigint();
            const duration = Number(end - start) / 1e9; // nanoseconds to seconds
            this.observe(name, duration);
            return duration;
        };
    }

    /**
     * Convertir labels a key
     */
    labelsToKey(labels) {
        return Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',') || '__default__';
    }

    /**
     * Exportar métricas en formato Prometheus
     */
    export() {
        const lines = [];
        lines.push('# Wix-Biller Integration Metrics\n');

        // Contadores
        for (const [name, counter] of this.counters) {
            lines.push(`# HELP ${name} ${counter.help}`);
            lines.push(`# TYPE ${name} counter`);

            if (counter.values.size === 0) {
                lines.push(`${name} 0`);
            } else {
                for (const [labels, value] of counter.values) {
                    if (labels === '__default__') {
                        lines.push(`${name} ${value}`);
                    } else {
                        lines.push(`${name}{${labels}} ${value}`);
                    }
                }
            }
            lines.push('');
        }

        // Gauges
        for (const [name, gauge] of this.gauges) {
            lines.push(`# HELP ${name} ${gauge.help}`);
            lines.push(`# TYPE ${name} gauge`);
            lines.push(`${name} ${gauge.value}`);
            lines.push('');
        }

        // Histograms
        for (const [name, hist] of this.histograms) {
            lines.push(`# HELP ${name} ${hist.help}`);
            lines.push(`# TYPE ${name} histogram`);

            // Calcular buckets
            const sorted = [...hist.values].sort((a, b) => a - b);
            for (const bucket of hist.buckets) {
                const count = sorted.filter(v => v <= bucket).length;
                lines.push(`${name}_bucket{le="${bucket}"} ${count}`);
            }
            lines.push(`${name}_bucket{le="+Inf"} ${hist.count}`);
            lines.push(`${name}_sum ${hist.sum}`);
            lines.push(`${name}_count ${hist.count}`);
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Obtener resumen para dashboard
     */
    getSummary() {
        const summary = {};

        for (const [name, counter] of this.counters) {
            let total = 0;
            for (const value of counter.values.values()) {
                total += value;
            }
            summary[name] = total;
        }

        for (const [name, gauge] of this.gauges) {
            summary[name] = gauge.value;
        }

        for (const [name, hist] of this.histograms) {
            summary[`${name}_avg`] = hist.count > 0 ? hist.sum / hist.count : 0;
            summary[`${name}_count`] = hist.count;
        }

        return summary;
    }

    /**
     * Reset todas las métricas (útil para tests)
     */
    reset() {
        for (const counter of this.counters.values()) {
            counter.values.clear();
        }
        for (const gauge of this.gauges.values()) {
            gauge.value = 0;
        }
        for (const hist of this.histograms.values()) {
            hist.values = [];
            hist.sum = 0;
            hist.count = 0;
        }
    }
}

// Singleton
let metricsInstance = null;

function getMetrics() {
    if (!metricsInstance) {
        metricsInstance = new PrometheusMetrics();
    }
    return metricsInstance;
}

module.exports = {
    PrometheusMetrics,
    getMetrics
};
