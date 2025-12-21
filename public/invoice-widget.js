/**
 * Invoice Viewer Widget - Web Component para Wix
 * Permite a clientes logueados ver sus comprobantes fiscales
 *
 * Uso en Wix:
 * <invoice-viewer
 *   backend-url="https://tu-app.onrender.com"
 *   customer-email="{{currentUser.email}}"
 *   lang="es">
 * </invoice-viewer>
 */

(function() {
  'use strict';

  // Traducciones
  const translations = {
    es: {
      title: 'Mis Comprobantes',
      loading: 'Cargando comprobantes...',
      noInvoices: 'No hay comprobantes disponibles.',
      loginRequired: 'Inicia sesion para ver tus comprobantes.',
      error: 'Error cargando comprobantes.',
      retry: 'Reintentar',
      downloadPdf: 'Descargar PDF',
      viewDetails: 'Ver detalles',
      date: 'Fecha',
      type: 'Tipo',
      number: 'Numero',
      total: 'Total',
      creditNote: 'Nota de Credito',
      eTicket: 'e-Ticket',
      eFactura: 'e-Factura'
    },
    en: {
      title: 'My Invoices',
      loading: 'Loading invoices...',
      noInvoices: 'No invoices available.',
      loginRequired: 'Log in to view your invoices.',
      error: 'Error loading invoices.',
      retry: 'Retry',
      downloadPdf: 'Download PDF',
      viewDetails: 'View details',
      date: 'Date',
      type: 'Type',
      number: 'Number',
      total: 'Total',
      creditNote: 'Credit Note',
      eTicket: 'e-Ticket',
      eFactura: 'e-Invoice'
    }
  };

  class InvoiceViewer extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._email = '';
      this._backendUrl = '';
      this._lang = 'es';
      this._invoices = [];
      this._loading = false;
      this._error = null;
    }

    static get observedAttributes() {
      return ['customer-email', 'backend-url', 'lang', 'theme'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (oldValue === newValue) return;

      switch (name) {
        case 'customer-email':
          this._email = newValue;
          if (newValue) this.loadInvoices();
          else this.render();
          break;
        case 'backend-url':
          this._backendUrl = newValue;
          if (this._email) this.loadInvoices();
          break;
        case 'lang':
          this._lang = newValue || 'es';
          this.render();
          break;
        case 'theme':
          this.render();
          break;
      }
    }

    connectedCallback() {
      this.render();
    }

    get t() {
      return translations[this._lang] || translations.es;
    }

    async loadInvoices() {
      if (!this._email || !this._backendUrl) {
        this.render();
        return;
      }

      this._loading = true;
      this._error = null;
      this.render();

      try {
        const response = await fetch(
          `${this._backendUrl}/api/customer/invoices?email=${encodeURIComponent(this._email)}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        this._invoices = data.invoices || [];
        this._error = null;
      } catch (error) {
        console.error('InvoiceViewer: Error loading invoices', error);
        this._error = error.message;
        this._invoices = [];
      } finally {
        this._loading = false;
        this.render();
      }
    }

    formatDate(dateStr) {
      if (!dateStr) return '-';
      const date = new Date(dateStr);
      return date.toLocaleDateString(this._lang === 'es' ? 'es-UY' : 'en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    }

    formatCurrency(amount, currency = 'UYU') {
      if (typeof amount !== 'number') return '-';
      return new Intl.NumberFormat(this._lang === 'es' ? 'es-UY' : 'en-US', {
        style: 'currency',
        currency: currency
      }).format(amount);
    }

    getTypeLabel(type, isCreditNote) {
      if (isCreditNote) return this.t.creditNote;
      if (type === 111 || type === 112 || type === 113) return this.t.eFactura;
      return this.t.eTicket;
    }

    getStyles() {
      const theme = this.getAttribute('theme') || 'light';
      const isDark = theme === 'dark';

      return `
        :host {
          display: block;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
          font-size: 14px;
          line-height: 1.5;
          color: ${isDark ? '#e0e0e0' : '#333'};
        }

        * {
          box-sizing: border-box;
        }

        .invoice-container {
          background: ${isDark ? '#1e1e1e' : '#ffffff'};
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, ${isDark ? '0.3' : '0.1'});
        }

        .invoice-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 1px solid ${isDark ? '#333' : '#eee'};
        }

        .invoice-title {
          font-size: 18px;
          font-weight: 600;
          margin: 0;
          color: ${isDark ? '#fff' : '#1a1a1a'};
        }

        .invoice-count {
          font-size: 12px;
          color: ${isDark ? '#888' : '#666'};
          background: ${isDark ? '#333' : '#f5f5f5'};
          padding: 4px 10px;
          border-radius: 12px;
        }

        .loading-state,
        .empty-state,
        .error-state,
        .login-state {
          text-align: center;
          padding: 40px 20px;
          color: ${isDark ? '#888' : '#666'};
        }

        .loading-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid ${isDark ? '#333' : '#eee'};
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 15px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .error-state {
          color: #ef4444;
        }

        .retry-btn {
          margin-top: 15px;
          padding: 8px 20px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          transition: background 0.2s;
        }

        .retry-btn:hover {
          background: #2563eb;
        }

        .invoice-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }

        .invoice-item {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;
          padding: 15px 0;
          border-bottom: 1px solid ${isDark ? '#333' : '#eee'};
          gap: 10px;
        }

        .invoice-item:last-child {
          border-bottom: none;
        }

        .invoice-info {
          flex: 1;
          min-width: 200px;
        }

        .invoice-number {
          font-weight: 600;
          color: ${isDark ? '#fff' : '#1a1a1a'};
          font-size: 15px;
        }

        .invoice-meta {
          display: flex;
          gap: 15px;
          margin-top: 5px;
          font-size: 13px;
          color: ${isDark ? '#888' : '#666'};
        }

        .invoice-type {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .invoice-type.credit-note {
          color: #f59e0b;
        }

        .invoice-total {
          font-weight: 600;
          font-size: 16px;
          color: ${isDark ? '#10b981' : '#059669'};
          min-width: 100px;
          text-align: right;
        }

        .invoice-actions {
          display: flex;
          gap: 8px;
        }

        .download-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          background: ${isDark ? '#2563eb' : '#3b82f6'};
          color: white;
          text-decoration: none;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          transition: background 0.2s;
          cursor: pointer;
          border: none;
        }

        .download-btn:hover {
          background: ${isDark ? '#1d4ed8' : '#2563eb'};
        }

        .download-btn svg {
          width: 16px;
          height: 16px;
        }

        .login-icon,
        .empty-icon {
          font-size: 40px;
          margin-bottom: 10px;
        }

        @media (max-width: 500px) {
          .invoice-container {
            padding: 15px;
          }

          .invoice-item {
            flex-direction: column;
            align-items: flex-start;
          }

          .invoice-total {
            text-align: left;
            margin-top: 10px;
          }

          .invoice-actions {
            width: 100%;
            margin-top: 10px;
          }

          .download-btn {
            flex: 1;
            justify-content: center;
          }
        }
      `;
    }

    render() {
      const t = this.t;

      let content = '';

      if (!this._email) {
        // No email - mostrar mensaje de login
        content = `
          <div class="login-state">
            <div class="login-icon">🔐</div>
            <p>${t.loginRequired}</p>
          </div>
        `;
      } else if (this._loading) {
        // Cargando
        content = `
          <div class="loading-state">
            <div class="loading-spinner"></div>
            <p>${t.loading}</p>
          </div>
        `;
      } else if (this._error) {
        // Error
        content = `
          <div class="error-state">
            <p>${t.error}</p>
            <p style="font-size: 12px; opacity: 0.8;">${this._error}</p>
            <button class="retry-btn" id="retry-btn">${t.retry}</button>
          </div>
        `;
      } else if (this._invoices.length === 0) {
        // Sin comprobantes
        content = `
          <div class="empty-state">
            <div class="empty-icon">📄</div>
            <p>${t.noInvoices}</p>
          </div>
        `;
      } else {
        // Lista de comprobantes
        const invoiceItems = this._invoices.map(invoice => `
          <li class="invoice-item">
            <div class="invoice-info">
              <div class="invoice-number">${invoice.numeroCompleto || `${invoice.serie}-${invoice.numero}`}</div>
              <div class="invoice-meta">
                <span class="invoice-type ${invoice.isCreditNote ? 'credit-note' : ''}">
                  ${this.getTypeLabel(invoice.type, invoice.isCreditNote)}
                </span>
                <span class="invoice-date">${this.formatDate(invoice.createdAt || invoice.fechaEmision)}</span>
              </div>
            </div>
            <div class="invoice-total">
              ${this.formatCurrency(invoice.total, invoice.moneda)}
            </div>
            <div class="invoice-actions">
              <a
                href="${this._backendUrl}${invoice.pdfUrl}?email=${encodeURIComponent(this._email)}"
                target="_blank"
                class="download-btn"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7,10 12,15 17,10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                PDF
              </a>
            </div>
          </li>
        `).join('');

        content = `
          <div class="invoice-header">
            <h3 class="invoice-title">${t.title}</h3>
            <span class="invoice-count">${this._invoices.length} comprobante${this._invoices.length !== 1 ? 's' : ''}</span>
          </div>
          <ul class="invoice-list">
            ${invoiceItems}
          </ul>
        `;
      }

      this.shadowRoot.innerHTML = `
        <style>${this.getStyles()}</style>
        <div class="invoice-container">
          ${content}
        </div>
      `;

      // Event listeners
      const retryBtn = this.shadowRoot.getElementById('retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => this.loadInvoices());
      }
    }
  }

  // Registrar el custom element
  if (!customElements.get('invoice-viewer')) {
    customElements.define('invoice-viewer', InvoiceViewer);
  }

  // Exponer globalmente para uso sin custom elements
  window.InvoiceViewer = InvoiceViewer;

})();
