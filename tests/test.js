/**
 * Tests básicos para la integración MercadoLibre ↔ Biller
 * Ejecutar: node tests/test.js
 */

// Cargar config primero
process.env.BILLER_TOKEN = 'test';
process.env.BILLER_EMPRESA_ID = '1';
process.env.ML_APP_ID = 'test';
process.env.ML_APP_SECRET = 'test';
process.env.SERVER_PUBLIC_URL = 'https://test.onrender.com';

const { validarRUT, extraerRUTDePedido, validarPedido } = require('../utils/validators');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const runTest = async () => {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error.message}`);
      failed++;
    }
  };
  testQueue.push(runTest);
}

const testQueue = [];

async function runTests() {
  console.log('\n📋 Ejecutando tests...\n');

  for (const testFn of testQueue) {
    await testFn();
  }

  console.log('\n' + '═'.repeat(40));
  console.log(`📊 Resultados: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(40) + '\n');

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

console.log('\n📋 Ejecutando tests...\n');

// ============================================================
// TESTS DE VALIDACIÓN DE RUT
// ============================================================

console.log('--- Validación de RUT ---\n');

test('RUT válido de 12 dígitos', () => {
  const result = validarRUT('212222220019');
  // Acepta RUT con formato correcto, validación final es en DGI
  assertTrue(result.valid, 'Debería aceptar RUT con formato válido');
  assertEqual(result.type, 'RUT');
});

test('CI válida de 8 dígitos', () => {
  const result = validarRUT('12345678');
  assertTrue(result.valid, 'Debería aceptar CI con formato válido');
  assertEqual(result.type, 'CI');
});

test('RUT con longitud incorrecta', () => {
  const result = validarRUT('123456');
  assertFalse(result.valid);
});

test('RUT de 12 dígitos con cualquier verificador', () => {
  // La validación definitiva la hace DGI
  const result = validarRUT('212222220011');
  assertTrue(result.valid, 'Debería aceptar formato válido');
});

test('RUT vacío', () => {
  const result = validarRUT('');
  assertFalse(result.valid);
});

test('RUT null', () => {
  const result = validarRUT(null);
  assertFalse(result.valid);
});

test('RUT con caracteres especiales (se limpian)', () => {
  const result = validarRUT('21.222.222-0019');
  assertTrue(result.valid);
  assertEqual(result.cleaned, '212222220019');
});

// ============================================================
// TESTS DE EXTRACCIÓN DE RUT DE PEDIDO
// ============================================================

console.log('\n--- Extracción de RUT de pedido ---\n');

test('Extraer RUT de note_attributes', () => {
  const order = {
    id: 1,
    note_attributes: [
      { name: 'rut', value: '212222220019' }
    ]
  };
  const { rut, source } = extraerRUTDePedido(order);
  assertEqual(rut, '212222220019');
  assertTrue(source.includes('note_attributes'));
});

test('Extraer RUT de nota del pedido', () => {
  const order = {
    id: 1,
    note: 'Por favor entregar rápido. RUT: 212222220019'
  };
  const { rut, source } = extraerRUTDePedido(order);
  assertEqual(rut, '212222220019');
  assertEqual(source, 'note');
});

test('Extraer CI de nota del pedido', () => {
  const order = {
    id: 1,
    note: 'CI: 12345672'
  };
  const { rut } = extraerRUTDePedido(order);
  assertEqual(rut, '12345672');
});

test('No extraer RUT inválido', () => {
  const order = {
    id: 1,
    note_attributes: [
      { name: 'rut', value: '123' } // Muy corto
    ]
  };
  const { rut } = extraerRUTDePedido(order);
  assertEqual(rut, null);
});

test('Obtener razón social de company', () => {
  const order = {
    id: 1,
    note_attributes: [{ name: 'rut', value: '212222220019' }],
    billing_address: { company: 'Mi Empresa S.A.' }
  };
  const { rut, razonSocial } = extraerRUTDePedido(order);
  assertEqual(rut, '212222220019');
  assertEqual(razonSocial, 'Mi Empresa S.A.');
});

// ============================================================
// TESTS DE VALIDACIÓN DE PEDIDO
// ============================================================

console.log('\n--- Validación de pedido ---\n');

test('Pedido válido', () => {
  const order = {
    id: 123,
    total_price: '100.00',
    line_items: [
      { title: 'Producto', price: '100.00', quantity: 1 }
    ]
  };
  const result = validarPedido(order);
  assertTrue(result.valid);
});

test('Pedido sin items', () => {
  const order = {
    id: 123,
    total_price: '100.00',
    line_items: []
  };
  const result = validarPedido(order);
  assertFalse(result.valid);
  assertTrue(result.errors.some(e => e.includes('items')));
});

test('Pedido null', () => {
  const result = validarPedido(null);
  assertFalse(result.valid);
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

test('Circuit breaker abre después de fallos', () => {
  const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3 });

  cb.recordFailure();
  cb.recordFailure();
  assertEqual(cb.getState().state, 'CLOSED');

  cb.recordFailure(); // Tercer fallo
  assertEqual(cb.getState().state, 'OPEN');
  assertFalse(cb.canExecute());
});

test('Circuit breaker resetea con éxito', () => {
  const cb = new CircuitBreaker({ name: 'test' });
  cb.recordFailure();
  cb.recordFailure();
  assertEqual(cb.getState().failures, 2);

  cb.recordSuccess();
  assertEqual(cb.getState().failures, 0);
});

// ============================================================
// TESTS DE ASYNC QUEUE
// ============================================================

console.log('\n--- Async Queue ---\n');

const { AsyncQueue } = require('../utils/queue');

test('Queue procesa tareas en orden', async () => {
  const queue = new AsyncQueue({ concurrency: 1 });
  const results = [];

  await Promise.all([
    queue.enqueue(async () => { results.push(1); }, { id: 't1' }),
    queue.enqueue(async () => { results.push(2); }, { id: 't2' }),
    queue.enqueue(async () => { results.push(3); }, { id: 't3' })
  ]);

  assertEqual(results.length, 3);
});

test('Queue respeta concurrencia', () => {
  const queue = new AsyncQueue({ concurrency: 2, maxQueueSize: 10 });
  const status = queue.getStatus();
  assertEqual(status.concurrency, 2);
});

// ============================================================
// EJECUTAR TESTS
// ============================================================

runTests();
