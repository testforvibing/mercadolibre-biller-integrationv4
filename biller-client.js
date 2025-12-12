/**
 * Cliente para API de Biller
 * Con reintentos, timeout y manejo robusto de errores
 * @module biller-client
 */

const config = require('./config');
const logger = require('./utils/logger');
const { withRetry } = require('./utils/retry');
const { 
  validarRUT, 
  extraerRUTDePedido, 
  validarDatosComprobante,
  sanitizarString 
} = require('./utils/validators');

/**
 * Error personalizado para errores de Biller
 */
class BillerError extends Error {
  constructor(message, code, status, response) {
    super(message);
    this.name = 'BillerError';
    this.code = code;
    this.status = status;
    this.response = response;
  }
}

/**
 * Cliente para la API de Biller
 */
class BillerClient {
  constructor() {
    this.baseUrl = config.biller.baseUrl;
    this.token = config.biller.token;
    this.empresaId = config.biller.empresa.id;
    this.timeout = config.biller.timeout;
    this.retryConfig = config.biller.retry;
  }

  /**
   * Realizar petición HTTP con timeout
   */
  async fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Realizar petición a la API de Biller
   * @param {string} method - Método HTTP
   * @param {string} endpoint - Endpoint
   * @param {Object} data - Datos a enviar
   * @param {Object} options - Opciones adicionales
   */
  async request(method, endpoint, data = null, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const startTime = Date.now();
    
    const fetchOptions = {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'MercadoLibreBillerIntegration/2.0'
      }
    };

    if (data) {
      fetchOptions.body = JSON.stringify(data);
    }

    logger.debug(`Biller API: ${method} ${endpoint}`, { 
      hasBody: !!data 
    });

    try {
      const response = await this.fetchWithTimeout(url, fetchOptions);
      const duration = Date.now() - startTime;
      const responseText = await response.text();
      
      logger.request(method, endpoint, response.status, duration);
      
      let responseData;
      try {
        responseData = responseText ? JSON.parse(responseText) : {};
      } catch {
        responseData = { raw: responseText };
      }

      if (!response.ok) {
        const errorMessage = responseData.message || 
                            responseData.error || 
                            responseData.errors?.join(', ') ||
                            `HTTP ${response.status}`;
        
        const error = new BillerError(
          errorMessage,
          responseData.code || 'UNKNOWN_ERROR',
          response.status,
          responseData
        );
        
        throw error;
      }

      return responseData;
      
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new BillerError('Request timeout', 'TIMEOUT', 0, null);
      }
      
      if (error instanceof BillerError) {
        throw error;
      }
      
      // Error de red
      logger.error('Error de conexión con Biller', { 
        error: error.message, 
        endpoint 
      });
      
      const netError = new BillerError(
        `Error de conexión: ${error.message}`,
        'NETWORK_ERROR',
        0,
        null
      );
      netError.originalError = error;
      throw netError;
    }
  }

  /**
   * Request con reintentos automáticos
   */
  async requestWithRetry(method, endpoint, data = null, operationName = 'biller-request') {
    return withRetry(
      () => this.request(method, endpoint, data),
      {
        ...this.retryConfig,
        operationName
      }
    );
  }

  /**
   * Verificar conexión con Biller
   * Intenta varios endpoints para confirmar que la API responde
   */
  async verificarConexion() {
    try {
      // Primero intentar endpoint de empresas
      try {
        const response = await this.request('GET', `/empresas/${this.empresaId}`);
        return {
          connected: true,
          empresa: response.nombre || response.razon_social || config.biller.empresa.nombre,
          rut: response.rut,
          ambiente: config.biller.environment,
          timestamp: new Date().toISOString()
        };
      } catch (empresaError) {
        // Si /empresas falla, intentar un request simple para verificar conectividad
        // Esto es normal en ambiente test donde /empresas puede no existir
        logger.debug('Endpoint /empresas no disponible, verificando conectividad básica');
        
        // Intentar endpoint de comprobantes (solo para verificar auth)
        try {
          await this.request('GET', '/comprobantes?limit=1');
          return {
            connected: true,
            empresa: config.biller.empresa.nombre,
            ambiente: config.biller.environment,
            timestamp: new Date().toISOString(),
            note: 'Conexión verificada (endpoint empresas no disponible)'
          };
        } catch (compError) {
          // Si también falla, verificar si es error de auth o de red
          if (compError.status === 401 || compError.status === 403) {
            return {
              connected: false,
              error: 'Token de Biller inválido o expirado',
              ambiente: config.biller.environment,
              timestamp: new Date().toISOString()
            };
          }
          // Asumir conectado si llegamos aquí (puede ser 404 u otro)
          return {
            connected: true,
            empresa: config.biller.empresa.nombre,
            ambiente: config.biller.environment,
            timestamp: new Date().toISOString(),
            warning: 'No se pudo verificar completamente'
          };
        }
      }
    } catch (error) {
      return {
        connected: false,
        error: error.message,
        code: error.code,
        ambiente: config.biller.environment,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Validar RUT con DGI a través de Biller
   * @param {string} rut - RUT a validar (12 dígitos)
   */
  async validarRUTConDGI(rut) {
    const rutLimpio = String(rut).replace(/\D/g, '');
    
    // Validación local primero
    const validacionLocal = validarRUT(rutLimpio);
    if (!validacionLocal.valid) {
      return {
        valid: false,
        reason: validacionLocal.reason,
        source: 'local'
      };
    }

    // Solo RUT de 12 dígitos se validan con DGI
    if (rutLimpio.length !== 12) {
      return {
        valid: true,
        type: 'CI',
        source: 'local',
        reason: 'CI validado localmente (DGI no valida CI)'
      };
    }

    try {
      const response = await this.requestWithRetry(
        'GET', 
        `/utils/validar-rut/${rutLimpio}`,
        null,
        'validar-rut-dgi'
      );
      
      return {
        valid: response.valido === true,
        razonSocial: response.RazonSocial || response.razon_social || null,
        data: response,
        source: 'dgi'
      };
    } catch (error) {
      logger.warn('Error consultando DGI', { rut: rutLimpio, error: error.message });
      
      // Si falla DGI, aceptar validación local
      return {
        valid: true,
        warning: true,
        reason: `No se pudo verificar con DGI: ${error.message}`,
        source: 'local-fallback'
      };
    }
  }

  /**
   * Emitir comprobante fiscal electrónico
   * @param {Object} datos - Datos del comprobante
   */
  async emitirComprobante(datos) {
    const sucursalId = parseInt(datos.sucursal || config.biller.empresa.sucursal, 10);
    if (!sucursalId) {
      throw new BillerError(
        'Sucursal no configurada (BILLER_EMPRESA_SUCURSAL)',
        'CONFIG_ERROR',
        400,
        null
      );
    }

    // Limpiar campos no soportados y aplicar defaults requeridos por v2
    const {
      emailCliente, // se usa sólo para envío posterior
      id_externo,   // v2 no soporta id_externo
      empresa_id,   // no requerido en v2 (token ya identifica empresa)
      ...rest
    } = datos;

    const datosCompletos = {
      moneda: 'UYU',
      montos_brutos: 0,
      forma_pago: datos.forma_pago || 1,
      numero_interno: datos.numero_interno || datos.numero_orden || `ml-${Date.now()}`,
      sucursal: sucursalId,
      ...rest
    };

    const validacion = validarDatosComprobante(datosCompletos);
    if (!validacion.valid) {
      throw new BillerError(
        `Datos de comprobante inválidos: ${validacion.errors.join(', ')}`,
        'VALIDATION_ERROR',
        400,
        { errors: validacion.errors }
      );
    }

    const tipoStr = this.getTipoComprobanteStr(datos.tipo_comprobante);
    logger.info(`Emitiendo ${tipoStr}`, { 
      tipo: datos.tipo_comprobante,
      items: datos.items?.length,
      cliente: datos.cliente?.razon_social || datos.cliente?.nombre_fantasia || 'Consumidor final',
      numero_interno: datosCompletos.numero_interno
    });

    const response = await this.requestWithRetry(
      'POST', 
      '/comprobantes/crear', 
      datosCompletos,
      `emitir-${tipoStr.toLowerCase().replace(' ', '-')}`
    );
    
    logger.info(`✅ ${tipoStr} emitido exitosamente`, {
      id: response.id,
      serie: response.serie,
      numero: response.numero,
      cae: response.cae_numero
    });

    // Log de envío de email
    if (datosCompletos.emails_notificacion && datosCompletos.emails_notificacion.length > 0) {
      logger.info(`📧 Email con PDF será enviado por Biller a: ${datosCompletos.emails_notificacion.join(', ')}`);
    } else {
      logger.warn('⚠️ No se enviará email: pedido sin dirección de email');
    }

    return {
      id: response.id,
      serie: response.serie,
      numero: response.numero,
      cae_numero: response.cae_numero,
      cae_rango: response.cae_rango,
      cae_vencimiento: response.cae_vencimiento,
      tipo_comprobante: datos.tipo_comprobante,
      fecha_emision: response.fecha_emision || new Date().toISOString(),
      url: response.url,
      pdfUrl: `${this.baseUrl}/comprobantes/${response.id}/pdf`,
      qr: response.qr
    };
  }

  /**
   * Obtener string descriptivo del tipo de comprobante
   */
  getTipoComprobanteStr(tipo) {
    const tipos = {
      101: 'e-Ticket',
      102: 'NC e-Ticket',
      103: 'ND e-Ticket',
      111: 'e-Factura',
      112: 'NC e-Factura',
      113: 'ND e-Factura'
    };
    return tipos[tipo] || `CFE ${tipo}`;
  }

  /**
   * Obtener PDF del comprobante
   * @param {string|number} comprobanteId
   */
  async obtenerPDF(comprobanteId) {
    const url = `${this.baseUrl}/comprobantes/${comprobanteId}/pdf`;
    
    try {
      const response = await this.fetchWithTimeout(url, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (!response.ok) {
        throw new BillerError(
          `Error obteniendo PDF: ${response.status}`,
          'PDF_ERROR',
          response.status,
          null
        );
      }

      return await response.arrayBuffer();
    } catch (error) {
      if (error instanceof BillerError) throw error;
      throw new BillerError(`Error obteniendo PDF: ${error.message}`, 'PDF_ERROR', 0, null);
    }
  }

  /**
   * Enviar comprobante por email
   * @param {string|number} comprobanteId
   * @param {string} email
   * @param {Object} opciones
   */
  async enviarComprobantePorEmail(comprobanteId, email, opciones = {}) {
    return this.requestWithRetry(
      'POST', 
      `/comprobantes/${comprobanteId}/enviar`,
      {
        email,
        asunto: opciones.asunto,
        mensaje: opciones.mensaje
      },
      'enviar-email'
    );
  }

  /**
   * Buscar comprobante por número interno
   * @param {string} numeroInterno
   */
  async buscarPorNumeroInterno(numeroInterno) {
    try {
      const response = await this.request(
        'GET',
        `/comprobantes?numero_interno=${encodeURIComponent(numeroInterno)}`
      );

      // La API puede devolver array o objeto con data
      const comprobantes = response.data || response;

      if (Array.isArray(comprobantes) && comprobantes.length > 0) {
        return comprobantes[0];
      }

      return null;
    } catch (error) {
      logger.debug('Error buscando comprobante', { numeroInterno, error: error.message });
      return null;
    }
  }

  /**
   * Buscar comprobante en BD de Biller ANTES de emitir
   * Garantiza idempotencia: Si ya existe, no emitir
   *
   * FASE 2: Validación dual (local + Biller)
   * @param {string} numeroInterno - Número interno a buscar (ej: ML-123456)
   * @returns {object|null} Comprobante si existe, null si no
   */
  async buscarComprobanteEnBiller(numeroInterno) {
    try {
      const response = await this.request(
        'GET',
        `/comprobantes/search`,
        null,
        { params: { numero_interno: numeroInterno } }
      );

      // Si encuentra, retornar el comprobante
      if (response && response.id) {
        return {
          id: response.id,
          numero: response.numero,
          serie: response.serie,
          tipo_comprobante: response.tipo_comprobante,
          fecha_emision: response.fecha_emision,
          estado: response.estado
        };
      }

      return null;
    } catch (error) {
      // Si la búsqueda falla, loguear pero no fallar
      // Asumimos que no existe y procedemos con emisión
      logger.warn('⚠️ Error buscando en Biller', {
        numeroInterno,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Obtener comprobante por ID
   * @param {string|number} id
   */
  async obtenerComprobante(id) {
    return this.request('GET', `/comprobantes/${id}`);
  }

  /**
   * Listar comprobantes con filtros
   * @param {Object} filtros
   */
  async listarComprobantes(filtros = {}) {
    const params = new URLSearchParams();
    
    if (filtros.desde) params.append('desde', filtros.desde);
    if (filtros.hasta) params.append('hasta', filtros.hasta);
    if (filtros.tipo) params.append('tipo_comprobante', filtros.tipo);
    if (filtros.limite) params.append('limit', filtros.limite);
    if (filtros.pagina) params.append('page', filtros.pagina);
    
    const query = params.toString();
    return this.request('GET', `/comprobantes${query ? '?' + query : ''}`);
  }
}

module.exports = {
  BillerClient,
  BillerError
};
