/**
 * Tests basicos para la integracion Wix <-> Biller
 * Ejecutar: node tests/test.js
 */

// Cargar config primero
process.env.BILLER_TOKEN = 'test';
process.env.BILLER_EMPRESA_ID = '1';
process.env.WIX_CLIENT_ID = 'test';
process.env.WIX_CLIENT_SECRET = 'test';
process.env.SERVER_PUBLIC_URL = 'https://test.onrender.com';

const config = require('../config');
const { determinarTipoComprobante, obtenerDepartamento, requiereIdentificacion } = require('../services/billing-decision');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const runTest = async () => {
    try {
      await fn();
      console.log(`OK ${name}`);
      passed++;
    } catch (error) {
      console.log(`FAIL ${name}`);
      console.log(`   Error: ${error.message}`);
      failed++;
    }
  };
  testQueue.push(runTest);
}

const testQueue = [];

async function runTests() {
  console.log('\nEjecutando tests...\n');

  for (const testFn of testQueue) {
    await testFn();
  }

  console.log('\n' + '='.repeat(40));
  console.log(`Resultados: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(40) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message = '') {
  if (!value) {
    throw new Error(message || 'Expected true');
  }
}

function assertFalse(value, message = '') {
  if (value) {
    throw new Error(message || 'Expected false');
  }
}

// ============================================================
// TESTS DE BILLING DECISION
// ============================================================

console.log('--- Billing Decision ---\n');

test('e-Factura para cliente con RUT empresa', () => {
  const orden = {
    id: 'order-123',
    fiscal: {
      tipoDocumento: 'UY_RUT',
      documento: '212222220019',
      razonSocial: 'Empresa Test SA',
      nombreCompleto: 'Empresa Test'
    },
    montos: { total: 1000 },
    buyer: { firstName: 'Juan', lastName: 'Perez' },
    direccion: { linea1: 'Av. 18 de Julio', ciudad: 'Montevideo' }
  };

  const decision = determinarTipoComprobante(orden);
  assertEqual(decision.tipo, config.TIPOS_CFE.E_FACTURA);
  assertEqual(decision.razon, 'RUT_EMPRESA');
  assertTrue(decision.cliente.documento === '212222220019');
});

test('e-Ticket para consumidor final sin datos', () => {
  const orden = {
    id: 'order-456',
    fiscal: { tipoDocumento: null, documento: null },
    montos: { total: 500 },
    buyer: { firstName: 'Maria', lastName: 'Lopez' },
    direccion: {}
  };

  const decision = determinarTipoComprobante(orden);
  assertEqual(decision.tipo, config.TIPOS_CFE.E_TICKET);
  assertEqual(decision.razon, 'CONSUMIDOR_FINAL');
  assertEqual(decision.cliente, config.CLIENTE_SIN_RECEPTOR);
});

test('e-Ticket con datos para monto > 5000 UI', () => {
  const limiteUI = config.dgi?.limiteMontoUYU || 30000;
  const montoAlto = (limiteUI + 10000) * 1.22; // Monto que supera el limite

  const orden = {
    id: 'order-789',
    fiscal: {
      tipoDocumento: 'UY_CI',
      documento: '12345678',
      nombreCompleto: 'Carlos Rodriguez'
    },
    montos: { total: montoAlto },
    buyer: { firstName: 'Carlos', lastName: 'Rodriguez' },
    direccion: { linea1: 'Calle 1', ciudad: 'Montevideo' }
  };

  const decision = determinarTipoComprobante(orden);
  assertEqual(decision.tipo, config.TIPOS_CFE.E_TICKET);
  assertEqual(decision.razon, 'MONTO_MAYOR_5000UI');
  assertTrue(decision.requiereIdentificacion);
});

test('e-Ticket con CI disponible (monto bajo)', () => {
  const orden = {
    id: 'order-101',
    fiscal: {
      tipoDocumento: 'UY_CI',
      documento: '12345678',
      nombreCompleto: 'Ana Martinez'
    },
    montos: { total: 1000 },
    buyer: { firstName: 'Ana', lastName: 'Martinez' },
    direccion: { linea1: 'Av Uruguay', ciudad: 'Montevideo' }
  };

  const decision = determinarTipoComprobante(orden);
  assertEqual(decision.tipo, config.TIPOS_CFE.E_TICKET);
  assertEqual(decision.razon, 'CI_DISPONIBLE');
  assertTrue(decision.cliente.documento === '12345678');
});

// ============================================================
// TESTS DE MAPEO DEPARTAMENTOS
// ============================================================

console.log('\n--- Mapeo Departamentos ---\n');

test('Mapeo UY-MO a Montevideo', () => {
  assertEqual(obtenerDepartamento('UY-MO'), 'Montevideo');
});

test('Mapeo UY-CA a Canelones', () => {
  assertEqual(obtenerDepartamento('UY-CA'), 'Canelones');
});

test('Mapeo UY-MA a Maldonado', () => {
  assertEqual(obtenerDepartamento('UY-MA'), 'Maldonado');
});

test('Subdivision no mapeada retorna original', () => {
  assertEqual(obtenerDepartamento('OTRO'), 'OTRO');
});

test('Subdivision null retorna null', () => {
  assertEqual(obtenerDepartamento(null), null);
});

// ============================================================
// TESTS DE REGLA 5000 UI
// ============================================================

console.log('\n--- Regla 5000 UI ---\n');

test('Monto bajo no requiere identificacion', () => {
  assertFalse(requiereIdentificacion(1000));
});

test('Monto alto requiere identificacion', () => {
  const limiteUI = config.dgi?.limiteMontoUYU || 30000;
  const montoAlto = (limiteUI + 5000) * 1.22;
  assertTrue(requiereIdentificacion(montoAlto));
});

// ============================================================
// TESTS DE CONFIG
// ============================================================

console.log('\n--- Configuracion ---\n');

test('Tipos CFE definidos correctamente', () => {
  assertEqual(config.TIPOS_CFE.E_TICKET, 101);
  assertEqual(config.TIPOS_CFE.E_FACTURA, 111);
  assertEqual(config.TIPOS_CFE.NC_E_TICKET, 102);
  assertEqual(config.TIPOS_CFE.NC_E_FACTURA, 112);
});

test('Tipos documento definidos', () => {
  assertEqual(config.TIPOS_DOCUMENTO.RUT, 2);
  assertEqual(config.TIPOS_DOCUMENTO.CI, 3);
});

test('Mapeo tipo documento Wix', () => {
  assertEqual(config.MAPEO_TIPO_DOCUMENTO_WIX['UY_RUT'], 2);
  assertEqual(config.MAPEO_TIPO_DOCUMENTO_WIX['UY_CI'], 3);
});

test('Cliente sin receptor definido', () => {
  assertEqual(config.CLIENTE_SIN_RECEPTOR, '-');
});

// ============================================================
// TESTS DE CIRCUIT BREAKER
// ============================================================

console.log('\n--- Circuit Breaker ---\n');

const { CircuitBreaker } = require('../utils/circuit-breaker');

test('Circuit breaker inicia cerrado', () => {
  const cb = new CircuitBreaker({ name: 'test' });
  assertEqual(cb.getState().state, 'CLOSED');
  assertTrue(cb.canExecute());
});

test('Circuit breaker abre despues de fallos', () => {
  const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3 });

  cb.recordFailure();
  cb.recordFailure();
  assertEqual(cb.getState().state, 'CLOSED');

  cb.recordFailure(); // Tercer fallo
  assertEqual(cb.getState().state, 'OPEN');
  assertFalse(cb.canExecute());
});

test('Circuit breaker resetea con exito', () => {
  const cb = new CircuitBreaker({ name: 'test' });
  cb.recordFailure();
  cb.recordFailure();
  assertEqual(cb.getState().failures, 2);

  cb.recordSuccess();
  assertEqual(cb.getState().failures, 0);
});

// ============================================================
// TESTS DE NOTAS DE CREDITO
// ============================================================

console.log('\n--- Notas de Credito ---\n');

const { obtenerTipoNC, debeEmitirNC } = require('../services/credit-note-service');

test('NC tipo correcto para e-Ticket (101 -> 102)', () => {
  assertEqual(obtenerTipoNC(101), 102);
});

test('NC tipo correcto para e-Factura (111 -> 112)', () => {
  assertEqual(obtenerTipoNC(111), 112);
});

test('NC tipo correcto para e-Factura exportacion (121 -> 122)', () => {
  assertEqual(obtenerTipoNC(121), 122);
});

test('NC tipo default es 102 para tipos desconocidos', () => {
  assertEqual(obtenerTipoNC(999), 102);
});

test('debeEmitirNC - evento canceled', () => {
  const orden = { paymentStatus: 'PAID' };
  assertTrue(debeEmitirNC('canceled', orden));
});

test('debeEmitirNC - evento order_canceled (con underscore)', () => {
  const orden = { paymentStatus: 'PAID' };
  assertTrue(debeEmitirNC('order_canceled', orden));
});

test('debeEmitirNC - evento transactionsUpdated con REFUNDED', () => {
  const orden = { paymentStatus: 'REFUNDED' };
  assertTrue(debeEmitirNC('transactionsUpdated', orden));
});

test('debeEmitirNC - evento transactions_updated con REFUNDED', () => {
  const orden = { paymentStatus: 'REFUNDED' };
  assertTrue(debeEmitirNC('transactions_updated', orden));
});

test('debeEmitirNC - evento transactionsUpdated sin REFUNDED no emite', () => {
  const orden = { paymentStatus: 'PAID' };
  assertFalse(debeEmitirNC('transactionsUpdated', orden));
});

test('debeEmitirNC - evento refunded con REFUNDED', () => {
  const orden = { paymentStatus: 'REFUNDED' };
  assertTrue(debeEmitirNC('refunded', orden));
});

test('debeEmitirNC - evento approved no emite NC', () => {
  const orden = { paymentStatus: 'PAID' };
  assertFalse(debeEmitirNC('approved', orden));
});

// ============================================================
// TESTS MOCK DE WIX ORDER
// ============================================================

console.log('\n--- Mock Wix Order ---\n');

test('Normalizar orden Wix basica', () => {
  // Este test verifica la estructura esperada de Wix
  const mockWixOrder = {
    id: 'order-wix-123',
    number: '1001',
    status: 'APPROVED',
    paymentStatus: 'PAID',
    _createdDate: '2024-01-15T10:00:00.000Z',
    billingInfo: {
      contactDetails: {
        firstName: 'Juan',
        lastName: 'Perez',
        phone: '099123456',
        vatId: {
          id: '212222220019',
          type: 'UY_RUT'
        },
        company: 'Empresa SA'
      },
      address: {
        addressLine1: 'Av 18 de Julio 1234',
        city: 'Montevideo',
        subdivision: 'UY-MO',
        country: 'UY'
      }
    },
    buyerInfo: {
      email: 'juan@empresa.com',
      firstName: 'Juan',
      lastName: 'Perez'
    },
    lineItems: [
      {
        id: 'item-1',
        productName: { translated: 'Producto Test' },
        quantity: 2,
        price: '100.00',
        totalPrice: '200.00',
        taxDetails: { taxRate: '22' }
      }
    ],
    priceSummary: {
      subtotal: { amount: '200.00' },
      shipping: { amount: '50.00' },
      tax: { amount: '55.00' },
      total: { amount: '305.00', currency: 'UYU' }
    }
  };

  // Verificar estructura basica
  assertTrue(mockWixOrder.id !== undefined);
  assertTrue(mockWixOrder.billingInfo !== undefined);
  assertTrue(mockWixOrder.lineItems.length > 0);
  assertEqual(mockWixOrder.priceSummary.total.currency, 'UYU');
});

// ============================================================
// TESTS DE BILLER CLIENT
// ============================================================

console.log('\n--- Biller Client ---\n');

const { BillerClient, BillerError } = require('../biller-client');

test('BillerClient getTipoComprobanteStr retorna nombres correctos', () => {
  const client = new BillerClient();
  assertEqual(client.getTipoComprobanteStr(101), 'e-Ticket');
  assertEqual(client.getTipoComprobanteStr(102), 'NC e-Ticket');
  assertEqual(client.getTipoComprobanteStr(111), 'e-Factura');
  assertEqual(client.getTipoComprobanteStr(112), 'NC e-Factura');
  assertEqual(client.getTipoComprobanteStr(121), 'e-Factura Exportación');
  assertEqual(client.getTipoComprobanteStr(181), 'eRemito');
  assertEqual(client.getTipoComprobanteStr(999), 'CFE 999'); // Desconocido
});

test('BillerError incluye codigo y status', () => {
  const error = new BillerError('Test error', 'TEST_CODE', 422, { detail: 'info' });
  assertEqual(error.message, 'Test error');
  assertEqual(error.code, 'TEST_CODE');
  assertEqual(error.status, 422);
  assertEqual(error.response.detail, 'info');
});

test('BillerClient baseUrl se configura segun ambiente', () => {
  const client = new BillerClient();
  assertTrue(client.baseUrl.includes('biller.uy'));
});

// ============================================================
// TESTS DE WEBHOOK SLUG PARSING
// ============================================================

console.log('\n--- Webhook Event Parsing ---\n');

// Simular la logica de parsing de eventos del servidor
function parseEventSlug(eventType) {
  return eventType?.split('.').pop()?.replace('order_', '') || eventType;
}

test('Parsing wix.ecom.v1.order_approved -> approved', () => {
  assertEqual(parseEventSlug('wix.ecom.v1.order_approved'), 'approved');
});

test('Parsing wix.ecom.v1.order_canceled -> canceled', () => {
  assertEqual(parseEventSlug('wix.ecom.v1.order_canceled'), 'canceled');
});

test('Parsing wix.ecom.v1.order_transactions_updated -> transactions_updated', () => {
  assertEqual(parseEventSlug('wix.ecom.v1.order_transactions_updated'), 'transactions_updated');
});

test('Parsing wix.ecom.v1.order_refunded -> refunded', () => {
  assertEqual(parseEventSlug('wix.ecom.v1.order_refunded'), 'refunded');
});

test('Parsing simple slug retorna igual', () => {
  assertEqual(parseEventSlug('approved'), 'approved');
  assertEqual(parseEventSlug('canceled'), 'canceled');
});

// ============================================================
// TESTS DE FLUJO COMPLETO
// ============================================================

console.log('\n--- Flujo Completo ---\n');

test('Flujo: Orden aprobada -> detecta evento emitir', () => {
  const eventosEmitir = ['approved'];
  const eventosAnular = ['canceled', 'transactionsUpdated'];

  const slug = 'approved';
  const esEventoEmitir = eventosEmitir.some(e => slug.includes(e));
  const esEventoAnular = eventosAnular.some(e => slug.includes(e));

  assertTrue(esEventoEmitir);
  assertFalse(esEventoAnular);
});

test('Flujo: Orden cancelada -> detecta evento anular', () => {
  const eventosEmitir = ['approved'];
  const eventosAnular = ['canceled', 'transactionsUpdated'];

  const slug = 'canceled';
  const esEventoEmitir = eventosEmitir.some(e => slug.includes(e));
  const esEventoAnular = eventosAnular.some(e => slug.includes(e));

  assertFalse(esEventoEmitir);
  assertTrue(esEventoAnular);
});

test('Flujo: transactions_updated -> detecta evento anular', () => {
  const eventosEmitir = ['approved'];
  const eventosAnular = ['canceled', 'transactionsUpdated'];

  const slug = 'transactions_updated';
  const eventType = 'wix.ecom.v1.order_transactions_updated';

  // Normalizar igual que el servidor
  const slugNorm = slug.toLowerCase().replace(/_/g, '');
  const eventTypeNorm = eventType.toLowerCase().replace(/_/g, '');

  // El match debe funcionar con normalizacion
  const esEventoAnular = eventosAnular.some(e => {
    const eNorm = e.toLowerCase().replace(/_/g, '');
    return slugNorm.includes(eNorm) || eventTypeNorm.includes(eNorm);
  });

  assertTrue(esEventoAnular);
});

test('Flujo: Indicadores IVA correctos', () => {
  assertEqual(config.INDICADORES_IVA.EXENTO, 1);
  assertEqual(config.INDICADORES_IVA.GRAVADO_MINIMA, 2);
  assertEqual(config.INDICADORES_IVA.GRAVADO_BASICA, 3);
});

test('Flujo: Formas de pago definidas', () => {
  assertEqual(config.FORMAS_PAGO.CONTADO, 1);
  assertEqual(config.FORMAS_PAGO.CREDITO, 2);
});

// ============================================================
// EJECUTAR TESTS
// ============================================================

runTests();
