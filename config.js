/**
 * Configuración de la integración MercadoLibre ↔ Biller
 * @module config
 */

require('dotenv').config();

/**
 * Tipos de comprobantes fiscales electrónicos (CFE) en Uruguay
 * Según documentación Biller API v2
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
  // e-Factura de exportación
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
 * Según documentación Biller API v2
 */
const TIPOS_DOCUMENTO = Object.freeze({
  RUT: 2,       // RUT (12 dígitos)
  CI: 3,        // Cédula de Identidad
  OTRO: 4,      // Otro
  PASAPORTE: 5, // Pasaporte
  DNI: 6,       // DNI (documento extranjero)
  NIFE: 7       // NIFE
});

/**
 * Formas de pago
 * Según documentación Biller API v2
 */
const FORMAS_PAGO = Object.freeze({
  CONTADO: 1,
  CREDITO: 2,
  // Aliases para compatibilidad
  EFECTIVO: 1,
  OTRO: 1  // Default a contado
});

/**
 * Indicadores de facturación para items
 * Según documentación Biller API v2
 */
const INDICADORES_IVA = Object.freeze({
  EXENTO: 1,                    // Exento de IVA
  GRAVADO_MINIMA: 2,            // Tasa mínima (10%)
  GRAVADO_BASICA: 3,            // Tasa básica (22%)
  OTRA_TASA: 4,                 // Otra tasa
  ENTREGA_GRATUITA: 5,          // Entrega gratuita
  NO_FACTURABLE: 6,             // Producto o servicio no facturable
  NO_FACTURABLE_NEGATIVO: 7,    // Producto o servicio no facturable negativo
  ITEM_REBAJAR: 8,              // Ítem a rebajar en e-remitos
  ITEM_ANULAR: 9,               // Ítem a anular en resguardos
  EXPORTACION: 10,              // Exportación y asimiladas
  IMPUESTO_PERCIBIDO: 11,       // Impuesto percibido
  IVA_SUSPENSO: 12,             // IVA en suspenso
  VENDIDO_NO_CONTRIBUYENTE: 13, // Ítem vendido no contribuyente
  VENDIDO_MONOTRIBUTO: 14,      // Ítem vendido contribuyente monotributo
  VENDIDO_IMEBA: 15,            // Ítem vendido contribuyente IMEBA
  VENDIDO_IVA_MINIMO: 16        // Ítem Vendido Contribuyente IVA mínimo, Monotributo o Monotributo MIDES
});

/**
 * Tipos de descuento/recargo para items
 * Según documentación Biller API v2
 */
const TIPOS_DESCUENTO = Object.freeze({
  PORCENTAJE: '%',
  MONTO: '$'
});

/**
 * Códigos de país más comunes
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
 * Configuración principal
 */
const config = {
  // Constantes
  TIPOS_CFE,
  TIPOS_DOCUMENTO,
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
    errors.push('SERVER_PUBLIC_URL debe configurarse con la URL pública (ej: https://tu-app.onrender.com)');
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
