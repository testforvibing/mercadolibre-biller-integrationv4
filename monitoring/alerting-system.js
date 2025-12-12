/**
 * AlertingSystem
 *
 * Sistema de alertas automáticas
 * Envía notificaciones a Slack/Email cuando se alcanzan thresholds
 *
 * FASE 3 - Observabilidad & Monitoreo
 */

const https = require('https');
const config = require('../config');

class AlertingSystem {
  constructor(metricsCollector) {
    this.metrics = metricsCollector;
    this.slackWebhook = process.env.SLACK_WEBHOOK_URL || null;
    this.emailService = process.env.SMTP_ENABLED === 'true' || false;

    // Thresholds
    this.thresholds = {
      pdf_failure_rate: parseFloat(process.env.ALERT_PDF_FAILURE_RATE) || 20,
      cache_hit_rate_min: parseFloat(process.env.ALERT_CACHE_HIT_RATE_MIN) || 50,
      api_latency_max: parseInt(process.env.ALERT_API_LATENCY_MAX) || 30000,
      error_rate_max: parseFloat(process.env.ALERT_ERROR_RATE_MAX) || 5,
      invoice_duplicate_zero: true  // Never allow duplicates
    };

    // Alert history (para evitar spam)
    this.alertHistory = new Map();
    this.alertCooldown = 5 * 60 * 1000; // 5 minutos

    // Iniciar monitoreo
    this.startMonitoring();
  }

  startMonitoring() {
    setInterval(() => {
      this.checkThresholds();
    }, 10000); // Cada 10 segundos
  }

  checkThresholds() {
    const stats = this.metrics.getStats();

    // Verificar duplicados de facturas (CRÍTICO)
    if (stats.invoices.duplicated_prevented > 0) {
      this.sendAlert('CRITICAL', '🔴 INVOICES DUPLICATED PREVENTED', {
        count: stats.invoices.duplicated_prevented,
        message: 'Duplicate invoice prevention triggered - Biller validation working'
      });
    }

    // Verificar tasa de fallos de PDF (ALTO)
    const totalPDFs = stats.pdfs.obtained + stats.pdfs.failed;
    if (totalPDFs > 0) {
      const pdfFailureRate = (stats.pdfs.failed / totalPDFs * 100);
      if (pdfFailureRate > this.thresholds.pdf_failure_rate) {
        this.sendAlert('HIGH', '🟡 PDF FAILURE RATE HIGH', {
          failure_rate: pdfFailureRate.toFixed(2) + '%',
          failed: stats.pdfs.failed,
          obtained: stats.pdfs.obtained,
          threshold: this.thresholds.pdf_failure_rate + '%'
        });
      }
    }

    // Verificar hit rate del caché (MEDIO)
    if (stats.cache.hit_rate_percent < this.thresholds.cache_hit_rate_min) {
      this.sendAlert('MEDIUM', '🟡 CACHE HIT RATE LOW', {
        hit_rate: stats.cache.hit_rate_percent + '%',
        threshold: this.thresholds.cache_hit_rate_min + '%',
        hits: stats.cache.hits,
        misses: stats.cache.misses
      });
    }

    // Verificar tasa de error general (MEDIO)
    const totalInvoices = stats.invoices.emitted + stats.invoices.duplicated_prevented;
    if (totalInvoices > 0) {
      const errorRate = ((totalInvoices - stats.invoices.emitted) / totalInvoices * 100);
      if (errorRate > this.thresholds.error_rate_max) {
        this.sendAlert('MEDIUM', '🟡 ERROR RATE HIGH', {
          error_rate: errorRate.toFixed(2) + '%',
          threshold: this.thresholds.error_rate_max + '%',
          total: totalInvoices,
          errors: stats.invoices.duplicated_prevented
        });
      }
    }

    // Verificar memory usage (MEDIO)
    if (stats.memory_usage_mb > 300) {
      this.sendAlert('MEDIUM', '🟡 HIGH MEMORY USAGE', {
        memory_mb: stats.memory_usage_mb,
        threshold: '300 MB'
      });
    }

    // Verificar uptime (INFO)
    if (parseInt(stats.uptime_hours) > 24) {
      // Una alerta de información cada 24h
      this.sendAlert('INFO', 'ℹ️ SYSTEM UPTIME', {
        uptime_hours: stats.uptime_hours,
        webhooks_processed: stats.webhooks.processed,
        invoices_emitted: stats.invoices.emitted
      });
    }
  }

  /**
   * Enviar alerta (con cooldown para evitar spam)
   */
  sendAlert(severity, title, data = {}) {
    const alertKey = `${severity}:${title}`;
    const now = Date.now();
    const lastAlert = this.alertHistory.get(alertKey);

    // Evitar spam: no enviar si se envió hace menos de 5 minutos
    if (lastAlert && (now - lastAlert) < this.alertCooldown) {
      return;
    }

    this.alertHistory.set(alertKey, now);

    // Enviar a Slack
    if (this.slackWebhook) {
      this.sendSlackAlert(severity, title, data);
    }

    // Log local
    console.log(`[ALERT ${severity}] ${title}`, data);
  }

  /**
   * Enviar alerta a Slack
   */
  sendSlackAlert(severity, title, data) {
    const colors = {
      CRITICAL: '#FF0000',
      HIGH: '#FF6600',
      MEDIUM: '#FFCC00',
      LOW: '#00CC00',
      INFO: '#0099FF'
    };

    const message = {
      attachments: [
        {
          color: colors[severity] || '#999999',
          title: title,
          text: JSON.stringify(data, null, 2),
          ts: Math.floor(Date.now() / 1000)
        }
      ]
    };

    const payload = JSON.stringify(message);

    const options = {
      hostname: 'hooks.slack.com',
      path: this.slackWebhook.replace(/^https:\/\/hooks.slack.com/, ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      // Silent success
    });

    req.on('error', (e) => {
      console.error('Error sending Slack alert:', e.message);
    });

    req.write(payload);
    req.end();
  }

  /**
   * Obtener historial de alertas recientes
   */
  getRecentAlerts(limit = 10) {
    const alerts = Array.from(this.alertHistory.entries())
      .map(([key, timestamp]) => ({
        alert: key,
        timestamp: new Date(timestamp).toISOString(),
        minutes_ago: Math.floor((Date.now() - timestamp) / 1000 / 60)
      }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);

    return alerts;
  }

  /**
   * Resetear historial
   */
  clearHistory() {
    this.alertHistory.clear();
  }
}

module.exports = AlertingSystem;
