/**
 * MetricsCollector
 *
 * Sistema de recolección de métricas en tiempo real
 * Exporta en formato Prometheus para monitoreo
 *
 * FASE 3 - Observabilidad & Monitoreo
 */

class MetricsCollector {
  constructor() {
    // Contadores (incrementan monotónicamente)
    this.counters = {
      webhooks_received_total: 0,
      webhooks_processed_total: 0,
      webhooks_duplicated_total: 0,
      webhooks_errors_total: 0,

      invoices_emitted_total: 0,
      invoices_duplicated_prevented: 0,
      invoice_errors_total: 0,

      pdfs_obtained_total: 0,
      pdfs_failed_total: 0,
      pdfs_retried_total: 0,

      cache_hits_total: 0,
      cache_misses_total: 0,
      cache_evictions_total: 0,

      api_requests_total: 0,
      api_errors_5xx_total: 0,
      api_errors_4xx_total: 0
    };

    // Gauges (pueden subir o bajar)
    this.gauges = {
      webhooks_pending: 0,
      pdfs_pending: 0,
      cache_size: 0,
      memory_usage_mb: 0,
      uptime_seconds: 0,
      active_workers: 0
    };

    // Histogramas (distribución de valores)
    this.histograms = {
      webhook_processing_ms: [],
      invoice_emission_ms: [],
      pdf_retrieval_ms: [],
      api_response_ms: [],
      pdf_attempt_count: []
    };

    // Timestamps para duraciones
    this.timers = new Map();

    // Iniciar recolección de métricas del sistema
    this.startSystemMetrics();
  }

  startSystemMetrics() {
    const startTime = Date.now();
    setInterval(() => {
      const memUsage = process.memoryUsage();
      this.gauges.memory_usage_mb = Math.round(memUsage.heapUsed / 1024 / 1024);
      this.gauges.uptime_seconds = Math.floor((Date.now() - startTime) / 1000);
    }, 5000);
  }

  // WEBHOOKS
  recordWebhookReceived() {
    this.counters.webhooks_received_total++;
    this.gauges.webhooks_pending++;
  }

  recordWebhookProcessed(success = true) {
    this.counters.webhooks_processed_total++;
    this.gauges.webhooks_pending = Math.max(0, this.gauges.webhooks_pending - 1);
    if (!success) this.counters.webhooks_errors_total++;
  }

  recordWebhookDuplicated() {
    this.counters.webhooks_duplicated_total++;
  }

  // INVOICES
  recordInvoiceEmitted() {
    this.counters.invoices_emitted_total++;
  }

  recordInvoiceDuplicatedPrevented() {
    this.counters.invoices_duplicated_prevented++;
  }

  recordInvoiceError() {
    this.counters.invoice_errors_total++;
  }

  // PDFs
  recordPDFPending(count = 1) {
    this.gauges.pdfs_pending += count;
  }

  recordPDFObtained(attemptCount = 1) {
    this.counters.pdfs_obtained_total++;
    this.gauges.pdfs_pending = Math.max(0, this.gauges.pdfs_pending - 1);
    this.histograms.pdf_attempt_count.push(attemptCount);
  }

  recordPDFFailed() {
    this.counters.pdfs_failed_total++;
    this.gauges.pdfs_pending = Math.max(0, this.gauges.pdfs_pending - 1);
  }

  recordPDFRetried() {
    this.counters.pdfs_retried_total++;
  }

  // CACHE
  recordCacheHit() {
    this.counters.cache_hits_total++;
  }

  recordCacheMiss() {
    this.counters.cache_misses_total++;
  }

  setCacheSize(size) {
    this.gauges.cache_size = size;
  }

  // API
  recordAPIRequest(statusCode, responseTime) {
    this.counters.api_requests_total++;
    this.histograms.api_response_ms.push(responseTime);
    if (statusCode >= 500) this.counters.api_errors_5xx_total++;
    else if (statusCode >= 400) this.counters.api_errors_4xx_total++;
  }

  getStats() {
    const totalWebhooks = this.counters.webhooks_received_total;
    const processedWebhooks = this.counters.webhooks_processed_total;
    const webhookSuccessRate = totalWebhooks > 0 ? (processedWebhooks / totalWebhooks * 100) : 0;

    const totalInvoices = this.counters.invoices_emitted_total + this.counters.invoice_errors_total;
    const invoiceSuccessRate = totalInvoices > 0 ? (this.counters.invoices_emitted_total / totalInvoices * 100) : 0;

    const totalCacheRequests = this.counters.cache_hits_total + this.counters.cache_misses_total;
    const cacheHitRate = totalCacheRequests > 0 ? (this.counters.cache_hits_total / totalCacheRequests * 100) : 0;

    return {
      timestamp: new Date().toISOString(),
      uptime_hours: (this.gauges.uptime_seconds / 3600).toFixed(2),
      memory_usage_mb: this.gauges.memory_usage_mb,
      webhooks: {
        received: this.counters.webhooks_received_total,
        processed: this.counters.webhooks_processed_total,
        duplicated: this.counters.webhooks_duplicated_total,
        success_rate_percent: webhookSuccessRate.toFixed(2)
      },
      invoices: {
        emitted: this.counters.invoices_emitted_total,
        duplicated_prevented: this.counters.invoices_duplicated_prevented,
        success_rate_percent: invoiceSuccessRate.toFixed(2)
      },
      pdfs: {
        obtained: this.counters.pdfs_obtained_total,
        pending: this.gauges.pdfs_pending,
        failed: this.counters.pdfs_failed_total
      },
      cache: {
        hits: this.counters.cache_hits_total,
        misses: this.counters.cache_misses_total,
        hit_rate_percent: cacheHitRate.toFixed(2)
      },
      api: {
        requests: this.counters.api_requests_total,
        errors_5xx: this.counters.api_errors_5xx_total,
        errors_4xx: this.counters.api_errors_4xx_total
      }
    };
  }

  exportPrometheus() {
    let output = '';
    output += `# HELP webhooks_received_total Total webhooks received\n`;
    output += `# TYPE webhooks_received_total counter\n`;
    output += `webhooks_received_total ${this.counters.webhooks_received_total}\n\n`;
    output += `# HELP webhooks_processed_total Total webhooks processed\n`;
    output += `# TYPE webhooks_processed_total counter\n`;
    output += `webhooks_processed_total ${this.counters.webhooks_processed_total}\n\n`;
    output += `# HELP invoices_emitted_total Total invoices emitted\n`;
    output += `# TYPE invoices_emitted_total counter\n`;
    output += `invoices_emitted_total ${this.counters.invoices_emitted_total}\n\n`;
    output += `# HELP pdfs_obtained_total Total PDFs obtained\n`;
    output += `# TYPE pdfs_obtained_total counter\n`;
    output += `pdfs_obtained_total ${this.counters.pdfs_obtained_total}\n\n`;
    output += `# HELP cache_hits_total Total cache hits\n`;
    output += `# TYPE cache_hits_total counter\n`;
    output += `cache_hits_total ${this.counters.cache_hits_total}\n\n`;
    output += `# HELP pdfs_pending Current PDFs pending\n`;
    output += `# TYPE pdfs_pending gauge\n`;
    output += `pdfs_pending ${this.gauges.pdfs_pending}\n\n`;
    output += `# HELP memory_usage_mb Memory usage in MB\n`;
    output += `# TYPE memory_usage_mb gauge\n`;
    output += `memory_usage_mb ${this.gauges.memory_usage_mb}\n\n`;
    return output;
  }

  reset() {
    for (const key in this.counters) this.counters[key] = 0;
    for (const key in this.gauges) this.gauges[key] = 0;
    for (const key in this.histograms) this.histograms[key] = [];
  }
}

module.exports = MetricsCollector;
