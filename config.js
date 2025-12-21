/**
 * Configuracion de la integracion Wix <-> Biller
 * @module config
 */

require('dotenv').config();

/**
 * Tipos de comprobantes fiscales electronicos (CFE) en Uruguay
 * Segun documentacion Biller API v2
 */
const TIPOS_CFE = Object.freeze({
  // e-Ticket
  E_TICKET: 101,
  NC_E_TICKET: 102,
  ND_E_TICKET: 103,
  // e-Factura
  E_FACTURA: 111,
  NC_E_FACTURA: 112,
  ND_E_FACTURA: 113,
  // e-Factura de exportacion
  E_FACTURA_EXPORTACION: 121,
  NC_E_FACTURA_EXPORTACION: 122,
  ND_E_FACTURA_EXPORTACION: 123,
  E_REMITO_EXPORTACION: 124,
  // e-Ticket Venta por cuenta ajena
  E_TICKET_CUENTA_AJENA: 131,
  NC_E_TICKET_CUENTA_AJENA: 132,
  ND_E_TICKET_CUENTA_AJENA: 133,
  // e-Factura Venta por cuenta ajena
  E_FACTURA_CUENTA_AJENA: 141,
  NC_E_FACTURA_CUENTA_AJENA: 142,
  ND_E_FACTURA_CUENTA_AJENA: 143,
  // eBoleta de entrada
  E_BOLETA_ENTRADA: 151,
  NC_E_BOLETA_ENTRADA: 152,
  ND_E_BOLETA_ENTRADA: 153,
  // Otros
  E_REMITO: 181,
  E_RESGUARDO: 182
});

/**
 * Tipos de documento de identidad
 * Segun documentacion Biller API v2
 */
const TIPOS_DOCUMENTO = Object.freeze({
  RUT: 2,       // RUT (12 digitos)
  CI: 3,        // Cedula de Identidad
  OTRO: 4,      // Otro
  PASAPORTE: 5, // Pasaporte
  DNI: 6,       // DNI (documento extranjero)
  NIFE: 7       // NIFE
});

/**
 * Mapeo de tipos de documento Wix -> Biller
 */
const MAPEO_TIPO_DOCUMENTO_WIX = Object.freeze({
  'UY_RUT': TIPOS_DOCUMENTO.RUT,
  'UY_CI': TIPOS_DOCUMENTO.CI,
  'OTHER': TIPOS_DOCUMENTO.OTRO,
  'PASSPORT': TIPOS_DOCUMENTO.PASAPORTE,
  'DNI': TIPOS_DOCUMENTO.DNI
});

/**
 * Formas de pago
 * Segun documentacion Biller API v2
 */
const FORMAS_PAGO = Object.freeze({
  CONTADO: 1,
  CREDITO: 2,
  // Aliases para compatibilidad
  EFECTIVO: 1,
  TARJETA: 2,
  OTRO: 1  // Default a contado
});

/**
 * Indicadores de facturacion para items
 * Segun documentacion Biller API v2
 */
const INDICADORES_IVA = Object.freeze({
  EXENTO: 1,                    // Exento de IVA
  GRAVADO_MINIMA: 2,            // Tasa minima (10%)
  GRAVADO_BASICA: 3,            // Tasa basica (22%)
  OTRA_TASA: 4,                 // Otra tasa
  ENTREGA_GRATUITA: 5,          // Entrega gratuita
  NO_FACTURABLE: 6,             // Producto o servicio no facturable
  NO_FACTURABLE_NEGATIVO: 7,    // Producto o servicio no facturable negativo
  ITEM_REBAJAR: 8,              // Item a rebajar en e-remitos
  ITEM_ANULAR: 9,               // Item a anular en resguardos
  EXPORTACION: 10,              // Exportacion y asimiladas
  IMPUESTO_PERCIBIDO: 11,       // Impuesto percibido
  IVA_SUSPENSO: 12,             // IVA en suspenso
  VENDIDO_NO_CONTRIBUYENTE: 13, // Item vendido no contribuyente
  VENDIDO_MONOTRIBUTO: 14,      // Item vendido contribuyente monotributo
  VENDIDO_IMEBA: 15,            // Item vendido contribuyente IMEBA
  VENDIDO_IVA_MINIMO: 16        // Item Vendido Contribuyente IVA minimo
});

/**
 * Tipos de descuento/recargo para items
 */
const TIPOS_DESCUENTO = Object.freeze({
  PORCENTAJE: '%',
  MONTO: '$'
});

/**
 * Codigos de pais mas comunes
 */
const PAISES = Object.freeze({
  URUGUAY: 'UY',
  ARGENTINA: 'AR',
  BRASIL: 'BR',
  ESTADOS_UNIDOS: 'US',
  PARAGUAY: 'PY',
  CHILE: 'CL',
  ESPANA: 'ES',
  MEXICO: 'MX'
});

/**
 * Cliente sin receptor para e-Ticket
 * Usar cuando no hay datos del comprador
 */
const CLIENTE_SIN_RECEPTOR = '-';

/**
 * Configuracion principal
 */
const config = {
  // Constantes
  TIPOS_CFE,
  TIPOS_DOCUMENTO,
  MAPEO_TIPO_DOCUMENTO_WIX,
  FORMAS_PAGO,
  INDICADORES_IVA,
  TIPOS_DESCUENTO,
  PAISES,
  CLIENTE_SIN_RECEPTOR,

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

    // Configuracion de reintentos
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
  // WIX
  // ============================================================
  wix: {
    // Credenciales de la aplicacion
    clientId: process.env.WIX_CLIENT_ID,
    clientSecret: process.env.WIX_CLIENT_SECRET,

    // Tokens OAuth
    accessToken: process.env.WIX_ACCESS_TOKEN,
    refreshToken: process.env.WIX_REFRESH_TOKEN,

    // Site ID
    siteId: process.env.WIX_SITE_ID,

    // API Base URL
    apiBaseUrl: process.env.WIX_API_BASE_URL || 'https://www.wixapis.com',

    // Public Key para verificar webhooks (JWT)
    webhookPublicKey: process.env.WIX_WEBHOOK_PUBLIC_KEY,

    // URL de redireccion para OAuth
    get redirectUri() {
      const serverUrl = process.env.SERVER_PUBLIC_URL || 'http://localhost:3000';
      return `${serverUrl}/auth/wix/callback`;
    },

    // Timeout de requests (ms)
    timeout: parseInt(process.env.WIX_TIMEOUT) || 30000,

    // Configuracion de reintentos
    retry: {
      maxAttempts: parseInt(process.env.WIX_RETRY_ATTEMPTS) || 3,
      initialDelay: parseInt(process.env.WIX_RETRY_DELAY) || 1000,
      maxDelay: parseInt(process.env.WIX_RETRY_MAX_DELAY) || 10000
    },

    // Eventos de webhook a procesar
    webhookEvents: {
      // Eventos que disparan emision de CFE
      emitir: (process.env.WIX_EVENTS_EMIT || 'approved').split(',').map(s => s.trim()),
      // Eventos que disparan emision de NC
      anular: (process.env.WIX_EVENTS_CANCEL || 'canceled,transactionsUpdated').split(',').map(s => s.trim())
    }
  },

  // ============================================================
  // SERVIDOR
  // ============================================================
  server: {
    port: parseInt(process.env.SERVER_PORT) || 3000,
    host: process.env.SERVER_HOST || '0.0.0.0',
    publicUrl: process.env.SERVER_PUBLIC_URL || 'http://localhost:3000',
    webhookPath: '/webhooks/wix',

    // Graceful shutdown timeout
    shutdownTimeout: parseInt(process.env.SHUTDOWN_TIMEOUT) || 10000
  },

  // ============================================================
  // FACTURACION
  // ============================================================
  facturacion: {
    validarRUTConDGI: process.env.VALIDAR_RUT_CON_DGI === 'true',
    enviarAlCliente: process.env.ENVIAR_COMPROBANTE_CLIENTE !== 'false',

    // IVA por defecto (22% = tasa basica)
    ivaDefault: parseInt(process.env.IVA_DEFAULT) || 22
  },

  // ============================================================
  // REGLAS DGI URUGUAY
  // ============================================================
  dgi: {
    // Limite de 5000 UI para identificar receptor en e-Ticket
    // Desde 01/11/2022, e-Tickets > 5000 UI requieren identificar al receptor
    limiteUI: 5000,

    // Valor de la UI en UYU (ACTUALIZAR MENSUALMENTE)
    // Fuente: https://www.ine.gub.uy/unidad-indexada
    valorUI: parseFloat(process.env.DGI_VALOR_UI) || 6.50,

    // Margen de seguridad (empezar a requerir datos antes del limite exacto)
    margenSeguridad: parseFloat(process.env.DGI_MARGEN_SEGURIDAD) || 0.92,

    // Calcular limite en UYU
    get limiteMontoUYU() {
      return Math.floor(this.limiteUI * this.valorUI * this.margenSeguridad);
    }
  },

  // ============================================================
  // PROCESAMIENTO
  // ============================================================
  procesamiento: {
    // Maximo de webhooks concurrentes
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_WEBHOOKS) || 3,

    // Tiempo de deduplicacion (ms)
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
 * Validar configuracion requerida
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
    errors.push('BILLER_EMPRESA_RUT debe tener 12 digitos');
  }

  // Wix
  if (!config.wix.clientId) {
    errors.push('WIX_CLIENT_ID es requerido');
  }
  if (!config.wix.clientSecret) {
    errors.push('WIX_CLIENT_SECRET es requerido');
  }

  // Servidor
  if (!config.server.publicUrl || config.server.publicUrl === 'http://localhost:3000') {
    errors.push('SERVER_PUBLIC_URL debe configurarse con la URL publica (ej: https://tu-app.onrender.com)');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Mostrar errores de configuracion
 */
function mostrarErrores() {
  const { valid, errors } = validarConfiguracion();

  if (!valid) {
    console.error('\n Errores de configuracion:');
    errors.forEach(e => console.error(`   - ${e}`));
    console.error('\nRevisa tu archivo .env\n');
  }

  return valid;
}

config.validar = validarConfiguracion;
config.mostrarErrores = mostrarErrores;

module.exports = config;
