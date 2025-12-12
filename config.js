/**
 * Configuración de la integración MercadoLibre ↔ Biller
 * @module config
 */

require('dotenv').config();

/**
 * Tipos de comprobantes fiscales electrónicos (CFE) en Uruguay
 */
const TIPOS_CFE = Object.freeze({
  E_TICKET: 101,
  NC_E_TICKET: 102,
  ND_E_TICKET: 103,
  E_FACTURA: 111,
  NC_E_FACTURA: 112,
  ND_E_FACTURA: 113,
  E_TICKET_CONTINGENCIA: 121,
  NC_E_TICKET_CONTINGENCIA: 122,
  ND_E_TICKET_CONTINGENCIA: 123,
  E_FACTURA_CONTINGENCIA: 131,
  NC_E_FACTURA_CONTINGENCIA: 132,
  ND_E_FACTURA_CONTINGENCIA: 133
});

/**
 * Tipos de documento de identidad
 */
const TIPOS_DOCUMENTO = Object.freeze({
  CI: 3,        // Cédula de Identidad
  RUT: 2,       // RUT
  PASAPORTE: 4, // Pasaporte
  OTRO: 5       // Otro
});

/**
 * Formas de pago
 */
const FORMAS_PAGO = Object.freeze({
  EFECTIVO: 1,
  TARJETA_CREDITO: 2,
  TARJETA_DEBITO: 3,
  TRANSFERENCIA: 4,
  CREDITO: 5,
  CHEQUE: 6,
  OTRO: 99
});

/**
 * Indicadores de IVA
 */
const INDICADORES_IVA = Object.freeze({
  EXENTO: 1,
  GRAVADO_MINIMA: 2,   // 10%
  GRAVADO_BASICA: 3,   // 22%
  NO_GRAVADO: 4
});

/**
 * Configuración principal
 */
const config = {
  // Constantes
  TIPOS_CFE,
  TIPOS_DOCUMENTO,
  FORMAS_PAGO,
  INDICADORES_IVA,

  // ============================================================
  // BILLER
  // ============================================================
  biller: {
    environment: process.env.BILLER_ENVIRONMENT || 'test',
    token: process.env.BILLER_TOKEN,

    get baseUrl() {
      return this.environment === 'production'
        ? 'https://biller.uy/v2'
        : 'https://test.biller.uy/v2';
    },

    empresa: {
      id: process.env.BILLER_EMPRESA_ID,
      rut: process.env.BILLER_EMPRESA_RUT,
      sucursal: process.env.BILLER_EMPRESA_SUCURSAL || null,
      nombre: process.env.BILLER_EMPRESA_NOMBRE || 'Mi Empresa'
    },

    // Configuración de reintentos
    retry: {
      maxAttempts: parseInt(process.env.BILLER_RETRY_ATTEMPTS) || 3,
      initialDelay: parseInt(process.env.BILLER_RETRY_DELAY) || 1000,
      maxDelay: parseInt(process.env.BILLER_RETRY_MAX_DELAY) || 10000,
      backoffFactor: 2
    },

    // Timeout de requests
    timeout: parseInt(process.env.BILLER_TIMEOUT) || 30000
  },

  // ============================================================
  // MERCADO LIBRE
  // ============================================================
  mercadolibre: {
    // Credenciales de la aplicacion
    appId: process.env.ML_APP_ID,
    appSecret: process.env.ML_APP_SECRET,

    // Tokens (obtenidos via OAuth)
    accessToken: process.env.ML_ACCESS_TOKEN,
    refreshToken: process.env.ML_REFRESH_TOKEN,

    // ID del usuario/vendedor
    userId: process.env.ML_USER_ID,

    // Pais (UY, AR, BR, MX, CL, CO)
    country: process.env.ML_COUNTRY || 'UY',

    // URL de redireccion para OAuth
    get redirectUri() {
      const serverUrl = process.env.SERVER_PUBLIC_URL || 'http://localhost:3000';
      return `${serverUrl}/auth/mercadolibre/callback`;
    },

    // Timeout de requests (ms)
    timeout: parseInt(process.env.ML_TIMEOUT) || 30000,

    // Configuracion de reintentos
    retry: {
      maxAttempts: parseInt(process.env.ML_RETRY_ATTEMPTS) || 3,
      initialDelay: parseInt(process.env.ML_RETRY_DELAY) || 1000,
      maxDelay: parseInt(process.env.ML_RETRY_MAX_DELAY) || 10000
    },

    // Topics de webhooks a suscribirse
    webhookTopics: ['orders_v2', 'payments', 'claims']
  },

  // ============================================================
  // SERVIDOR
  // ============================================================
  server: {
    port: parseInt(process.env.SERVER_PORT) || 3000,
    host: process.env.SERVER_HOST || '0.0.0.0',
    publicUrl: process.env.SERVER_PUBLIC_URL || 'http://localhost:3000',
    webhookPath: '/webhooks/mercadolibre',

    // Graceful shutdown timeout
    shutdownTimeout: parseInt(process.env.SHUTDOWN_TIMEOUT) || 10000
  },

  // ============================================================
  // FACTURACIÓN
  // ============================================================
  facturacion: {
    validarRUTConDGI: process.env.VALIDAR_RUT_CON_DGI === 'true',
    enviarAlCliente: process.env.ENVIAR_COMPROBANTE_CLIENTE !== 'false',
    agregarNotaEnPedido: process.env.AGREGAR_LINK_EN_PEDIDO !== 'false',

    // IVA por defecto (22% = tasa básica)
    ivaDefault: parseInt(process.env.IVA_DEFAULT) || 22,

    // Campos donde buscar RUT
    camposRUT: [
      'rut', 'RUT', 'rut_ci', 'RUT_CI', 'documento', 'tax_id',
      'vat_number', 'ruc', 'ci', 'CI', 'cedula'
    ],

    // Campos donde buscar razón social
    camposRazonSocial: [
      'razon_social', 'razonSocial', 'empresa', 'company',
      'business_name', 'nombre_empresa'
    ]
  },

  // ============================================================
  // REGLAS DGI URUGUAY
  // ============================================================
  dgi: {
    // Límite de 5000 UI para identificar receptor en e-Ticket
    // Desde 01/11/2022, e-Tickets > 5000 UI requieren identificar al receptor
    limiteUI: 5000,

    // Valor de la UI en UYU (ACTUALIZAR MENSUALMENTE)
    // Fuente: https://www.ine.gub.uy/unidad-indexada
    valorUI: parseFloat(process.env.DGI_VALOR_UI) || 6.50,

    // Margen de seguridad (empezar a requerir datos antes del límite exacto)
    margenSeguridad: parseFloat(process.env.DGI_MARGEN_SEGURIDAD) || 0.92,

    // Calcular límite en UYU
    get limiteMontoUYU() {
      return Math.floor(this.limiteUI * this.valorUI * this.margenSeguridad);
    }
  },

  // ============================================================
  // SUBIDA DE FACTURAS A MERCADOLIBRE
  // ============================================================
  mlInvoiceUpload: {
    // Habilitar subida automática de PDFs a MercadoLibre
    enabled: process.env.ML_INVOICE_UPLOAD_ENABLED !== 'false',

    // Intervalo de procesamiento del worker (ms)
    processInterval: parseInt(process.env.ML_UPLOAD_INTERVAL) || 30000,

    // Máximo intentos de subida
    maxAttempts: parseInt(process.env.ML_UPLOAD_MAX_ATTEMPTS) || 5,

    // También agregar nota con link en la orden
    agregarNota: process.env.ML_AGREGAR_NOTA !== 'false'
  },

  // ============================================================
  // PROCESAMIENTO
  // ============================================================
  procesamiento: {
    // Máximo de webhooks concurrentes
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_WEBHOOKS) || 3,

    // Tiempo de deduplicación (ms)
    dedupeWindow: parseInt(process.env.DEDUPE_WINDOW) || 5 * 60 * 1000,

    // Intervalo de limpieza de cache (ms)
    cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL) || 10 * 60 * 1000
  },

  // ============================================================
  // PERSISTENCIA
  // ============================================================
  storage: {
    // Ruta del archivo de comprobantes
    comprobantesFile: process.env.STORAGE_FILE || './data/comprobantes.json',

    // Auto-guardar cada N segundos
    autoSaveInterval: parseInt(process.env.AUTO_SAVE_INTERVAL) || 30
  },

  // ============================================================
  // LOGGING
  // ============================================================
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'pretty', // 'pretty' o 'json'
    includeTimestamp: true
  }
};

/**
 * Validar configuración requerida
 * @returns {{valid: boolean, errors: string[]}}
 */
function validarConfiguracion() {
  const errors = [];

  // Biller
  if (!config.biller.token) {
    errors.push('BILLER_TOKEN es requerido');
  }
  if (!config.biller.empresa.id) {
    errors.push('BILLER_EMPRESA_ID es requerido');
  }
  if (config.biller.empresa.rut && !/^\d{12}$/.test(config.biller.empresa.rut)) {
    errors.push('BILLER_EMPRESA_RUT debe tener 12 dígitos');
  }

  // MercadoLibre
  if (!config.mercadolibre.appId) {
    errors.push('ML_APP_ID es requerido');
  }
  if (!config.mercadolibre.appSecret) {
    errors.push('ML_APP_SECRET es requerido');
  }

  // Servidor
  if (!config.server.publicUrl || config.server.publicUrl === 'http://localhost:3000') {
    errors.push('SERVER_PUBLIC_URL debe configurarse con la URL pública (ngrok)');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Mostrar errores de configuración
 */
function mostrarErrores() {
  const { valid, errors } = validarConfiguracion();

  if (!valid) {
    console.error('\n❌ Errores de configuración:');
    errors.forEach(e => console.error(`   • ${e}`));
    console.error('\nRevisa tu archivo .env\n');
  }

  return valid;
}

config.validar = validarConfiguracion;
config.mostrarErrores = mostrarErrores;

module.exports = config;
