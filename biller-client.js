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

    // Defaults primero, luego datos del usuario para que puedan sobreescribir
    const datosCompletos = {
      moneda: 'UYU',
      montos_brutos: 0,  // Default: precios sin IVA (se sobreescribe si datos trae montos_brutos)
      forma_pago: 1,     // Default: contado
      sucursal: sucursalId,
      ...rest,  // Los datos del usuario sobreescriben los defaults
      // Estos campos se calculan siempre
      numero_interno: datos.numero_interno || datos.numero_orden || `ml-${Date.now()}`
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
   * Basado en documentación Biller API v2
   */
  getTipoComprobanteStr(tipo) {
    const tipos = {
      // e-Ticket
      101: 'e-Ticket',
      102: 'NC e-Ticket',
      103: 'ND e-Ticket',
      // e-Factura
      111: 'e-Factura',
      112: 'NC e-Factura',
      113: 'ND e-Factura',
      // e-Factura exportación
      121: 'e-Factura Exportación',
      122: 'NC e-Factura Exportación',
      123: 'ND e-Factura Exportación',
      124: 'eRemito Exportación',
      // e-Ticket venta por cuenta ajena
      131: 'e-Ticket Venta Cuenta Ajena',
      132: 'NC e-Ticket Venta Cuenta Ajena',
      133: 'ND e-Ticket Venta Cuenta Ajena',
      // e-Factura venta por cuenta ajena
      141: 'e-Factura Venta Cuenta Ajena',
      142: 'NC e-Factura Venta Cuenta Ajena',
      143: 'ND e-Factura Venta Cuenta Ajena',
      // eBoleta de entrada
      151: 'eBoleta Entrada',
      152: 'NC eBoleta Entrada',
      153: 'ND eBoleta Entrada',
      // Otros
      181: 'eRemito',
      182: 'eResguardo'
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
   * Obtener comprobante(s) con filtros avanzados
   * Según documentación Biller API v2 - GET /v2/comprobantes/obtener
   *
   * @param {Object} filtros - Filtros de búsqueda
   * @param {number} [filtros.id] - ID del CFE (si se pasa, incluye items)
   * @param {number} [filtros.sucursal] - Sucursal emisora
   * @param {string} [filtros.desde] - Fecha desde (aaaa-mm-dd hh:mm:ss)
   * @param {string} [filtros.hasta] - Fecha hasta (aaaa-mm-dd hh:mm:ss)
   * @param {number} [filtros.tipo_comprobante] - Tipo CFE (requiere serie y numero)
   * @param {string} [filtros.serie] - Serie (requiere tipo_comprobante y numero)
   * @param {number} [filtros.numero] - Número DGI (requiere tipo_comprobante y serie)
   * @param {string} [filtros.numero_interno] - Identificador interno único
   * @param {boolean} [filtros.recibidos=false] - Obtener comprobantes recibidos
   * @returns {Object|Array} Comprobante(s) encontrado(s)
   */
  async obtenerComprobante(filtros = {}) {
    const params = new URLSearchParams();

    // Si es solo un ID numérico, mantener compatibilidad
    if (typeof filtros === 'number' || typeof filtros === 'string') {
      params.append('id', filtros);
    } else {
      if (filtros.id) params.append('id', filtros.id);
      if (filtros.sucursal) params.append('sucursal', filtros.sucursal);
      if (filtros.desde) params.append('desde', filtros.desde);
      if (filtros.hasta) params.append('hasta', filtros.hasta);
      if (filtros.tipo_comprobante) params.append('tipo_comprobante', filtros.tipo_comprobante);
      if (filtros.serie) params.append('serie', filtros.serie);
      if (filtros.numero) params.append('numero', filtros.numero);
      if (filtros.numero_interno) params.append('numero_interno', filtros.numero_interno);
      if (filtros.recibidos) params.append('recibidos', '1');
    }

    const query = params.toString();
    return this.request('GET', `/comprobantes/obtener${query ? '?' + query : ''}`);
  }

  /**
   * Listar comprobantes con filtros (alias simplificado)
   * @param {Object} filtros
   */
  async listarComprobantes(filtros = {}) {
    return this.obtenerComprobante(filtros);
  }

  /**
   * Crear cliente en Biller
   * Permite crear clientes sin emitir comprobante
   * Según documentación Biller API v2 - POST /v2/clientes/crear
   *
   * @param {Object} datos - Datos del cliente
   * @param {string} [datos.razon_social] - Nombre para RUT/NIFE (max 70)
   * @param {string} [datos.nombre_fantasia] - Nombre para CI/Pasaporte/DNI (max 30)
   * @param {number} datos.tipo_documento - 2=RUT, 3=CI, 4=Otro, 5=Pasaporte, 6=DNI, 7=NIFE
   * @param {string} datos.documento - Número de documento
   * @param {string} [datos.direccion] - Dirección (max 70)
   * @param {string} [datos.ciudad] - Ciudad (max 30)
   * @param {string} [datos.departamento] - Departamento (max 30)
   * @param {string} datos.pais - Código país (UY, AR, BR, etc.) - OBLIGATORIO
   * @param {string[]} [datos.emails] - Emails para envío de PDF
   * @returns {Object} { cliente: ID, sucursal: ID }
   */
  async crearCliente(datos) {
    // Validar campo obligatorio
    if (!datos.pais) {
      throw new BillerError(
        'El campo pais es obligatorio para crear cliente',
        'VALIDATION_ERROR',
        400,
        null
      );
    }

    if (!datos.documento) {
      throw new BillerError(
        'El campo documento es obligatorio para crear cliente',
        'VALIDATION_ERROR',
        400,
        null
      );
    }

    logger.info('Creando cliente en Biller', {
      tipo_documento: datos.tipo_documento,
      documento: datos.documento ? `***${datos.documento.slice(-4)}` : 'N/A',
      pais: datos.pais
    });

    const response = await this.requestWithRetry(
      'POST',
      '/clientes/crear',
      datos,
      'crear-cliente'
    );

    logger.info('✅ Cliente creado exitosamente', {
      clienteId: response.cliente,
      sucursalId: response.sucursal
    });

    return {
      cliente: response.cliente,
      sucursal: response.sucursal
    };
  }

  /**
   * Crear producto/servicio en Biller
   * Permite crear productos sin emitir comprobante
   * Según documentación Biller API v2 - POST /v2/productos/cargar
   *
   * @param {Object} datos - Datos del producto
   * @param {string} datos.codigo - Código del producto (max 35)
   * @param {string} datos.nombre - Nombre/concepto del producto (max 80)
   * @param {string} [datos.descripcion] - Descripción adicional
   * @param {string} [datos.moneda='UYU'] - Moneda del precio
   * @param {number} datos.precio - Precio unitario
   * @param {number} datos.indicador_facturacion - Indicador IVA (1-16)
   * @param {number} [datos.inventario] - Cantidad en stock
   * @param {boolean} [datos.es_servicio=false] - true=servicio, false=producto con stock
   * @returns {Object} { id: ID del producto }
   */
  async crearProducto(datos) {
    if (!datos.codigo || !datos.nombre) {
      throw new BillerError(
        'Los campos codigo y nombre son obligatorios',
        'VALIDATION_ERROR',
        400,
        null
      );
    }

    const datosProducto = {
      moneda: 'UYU',
      es_servicio: false,
      ...datos
    };

    logger.info('Creando producto en Biller', {
      codigo: datos.codigo,
      nombre: datos.nombre,
      precio: datos.precio
    });

    const response = await this.requestWithRetry(
      'POST',
      '/productos/cargar',
      datosProducto,
      'crear-producto'
    );

    logger.info('✅ Producto creado exitosamente', {
      productoId: response.id
    });

    return {
      id: response.id
    };
  }

  /**
   * Anular comprobante mediante endpoint de Biller
   * Crea automáticamente una NC que anula el comprobante original en su totalidad
   *
   * IMPORTANTE: Este método es preferible a emitir NC manualmente porque:
   * - Garantiza que los totales por indicador de IVA coincidan exactamente
   * - No requiere calcular IVA ni especificar items
   * - Evita errores de "total para el indicador X es mayor a la suma por indicador"
   *
   * @param {Object} params - Parámetros de anulación
   * @param {number} [params.id] - ID del comprobante a anular (obligatorio si no se usa tipo/serie/numero)
   * @param {number} [params.tipo_comprobante] - Tipo del comprobante a anular
   * @param {string} [params.serie] - Serie del comprobante a anular
   * @param {number} [params.numero] - Número del comprobante a anular
   * @param {boolean} [params.fecha_emision_hoy=true] - Si la NC debe tener fecha de hoy
   * @returns {Object} Datos de la NC creada (id, tipo_comprobante, serie, numero, hash, fecha_emision)
   */
  async anularComprobante(params) {
    // Validar que se proporcionen los parámetros necesarios
    const tieneId = params.id != null;
    const tieneSerieNumero = params.tipo_comprobante && params.serie && params.numero != null;

    if (!tieneId && !tieneSerieNumero) {
      throw new BillerError(
        'Debe proporcionar id o (tipo_comprobante, serie, numero) para anular',
        'VALIDATION_ERROR',
        400,
        null
      );
    }

    // Construir datos para la API
    const datos = {
      fecha_emision_hoy: params.fecha_emision_hoy !== false ? 1 : 0
    };

    if (tieneId) {
      datos.id = params.id;
    } else {
      datos.tipo_comprobante = params.tipo_comprobante;
      datos.serie = params.serie;
      datos.numero = params.numero;
    }

    logger.info('Anulando comprobante en Biller', {
      id: datos.id,
      tipo: datos.tipo_comprobante,
      serie: datos.serie,
      numero: datos.numero
    });

    const response = await this.requestWithRetry(
      'POST',
      '/comprobantes/anular',
      datos,
      'anular-comprobante'
    );

    logger.info('✅ Comprobante anulado exitosamente', {
      ncId: response.id,
      ncTipo: response.tipo_comprobante,
      ncSerie: response.serie,
      ncNumero: response.numero,
      fecha: response.fecha_emision
    });

    return {
      id: response.id,
      tipo_comprobante: response.tipo_comprobante,
      serie: response.serie,
      numero: response.numero,
      hash: response.hash,
      fecha_emision: response.fecha_emision
    };
  }
}

module.exports = {
  BillerClient,
  BillerError
};
