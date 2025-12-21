/**
 * Datos mock para testing de la integracion Wix-Biller
 * Usar para probar localmente sin conexion a Wix
 */

// ============================================================
// ORDENES MOCK
// ============================================================

/**
 * Orden basica - Consumidor final sin datos fiscales
 * Resultado esperado: e-Ticket (101) sin receptor
 */
const ordenConsumidorFinal = {
  id: 'wix-order-001',
  number: '1001',
  status: 'APPROVED',
  paymentStatus: 'PAID',
  _createdDate: new Date().toISOString(),
  _updatedDate: new Date().toISOString(),
  billingInfo: {
    contactDetails: {
      firstName: 'Maria',
      lastName: 'Garcia',
      phone: '099111222'
    },
    address: {
      addressLine1: 'Av Italia 1234',
      city: 'Montevideo',
      subdivision: 'UY-MO',
      postalCode: '11300',
      country: 'UY'
    }
  },
  buyerInfo: {
    email: 'maria.garcia@gmail.com',
    firstName: 'Maria',
    lastName: 'Garcia'
  },
  lineItems: [
    {
      id: 'item-001',
      productName: { translated: 'Camiseta Basica', original: 'Camiseta Basica' },
      quantity: 2,
      price: '450.00',
      totalPrice: '900.00',
      taxDetails: { taxRate: '22' }
    }
  ],
  priceSummary: {
    subtotal: { amount: '900.00' },
    shipping: { amount: '150.00' },
    tax: { amount: '231.00' },
    total: { amount: '1050.00', currency: 'UYU' }
  },
  taxInfo: {
    taxIncludedInPrices: true,
    totalTax: '189.34'
  }
};

/**
 * Orden con RUT de empresa
 * Resultado esperado: e-Factura (111)
 */
const ordenEmpresa = {
  id: 'wix-order-002',
  number: '1002',
  status: 'APPROVED',
  paymentStatus: 'PAID',
  _createdDate: new Date().toISOString(),
  _updatedDate: new Date().toISOString(),
  billingInfo: {
    contactDetails: {
      firstName: 'Carlos',
      lastName: 'Rodriguez',
      phone: '099333444',
      company: 'Soluciones Tech SA',
      vatId: {
        id: '212222220019',
        type: 'UY_RUT'
      }
    },
    address: {
      addressLine1: 'Av 18 de Julio 1234 Of 301',
      city: 'Montevideo',
      subdivision: 'UY-MO',
      postalCode: '11100',
      country: 'UY'
    }
  },
  buyerInfo: {
    email: 'facturacion@solucionestech.com.uy',
    firstName: 'Carlos',
    lastName: 'Rodriguez'
  },
  lineItems: [
    {
      id: 'item-002',
      productName: { translated: 'Servicio Consultoria', original: 'Consultoria' },
      quantity: 1,
      price: '5000.00',
      totalPrice: '5000.00',
      taxDetails: { taxRate: '22' }
    },
    {
      id: 'item-003',
      productName: { translated: 'Licencia Software', original: 'Software' },
      quantity: 3,
      price: '1200.00',
      totalPrice: '3600.00',
      taxDetails: { taxRate: '22' }
    }
  ],
  priceSummary: {
    subtotal: { amount: '8600.00' },
    shipping: { amount: '0.00' },
    tax: { amount: '1892.00' },
    total: { amount: '8600.00', currency: 'UYU' }
  },
  taxInfo: {
    taxIncludedInPrices: true,
    totalTax: '1549.18'
  }
};

/**
 * Orden con monto alto (> 5000 UI) con CI
 * Resultado esperado: e-Ticket (101) con receptor identificado
 */
const ordenMontoAlto = {
  id: 'wix-order-003',
  number: '1003',
  status: 'APPROVED',
  paymentStatus: 'PAID',
  _createdDate: new Date().toISOString(),
  _updatedDate: new Date().toISOString(),
  billingInfo: {
    contactDetails: {
      firstName: 'Juan',
      lastName: 'Martinez',
      phone: '099555666',
      vatId: {
        id: '45678901',
        type: 'UY_CI'
      }
    },
    address: {
      addressLine1: 'Rambla Gandhi 500',
      addressLine2: 'Apto 1201',
      city: 'Montevideo',
      subdivision: 'UY-MO',
      postalCode: '11300',
      country: 'UY'
    }
  },
  buyerInfo: {
    email: 'juan.martinez@hotmail.com',
    firstName: 'Juan',
    lastName: 'Martinez'
  },
  lineItems: [
    {
      id: 'item-004',
      productName: { translated: 'MacBook Pro 14"', original: 'MacBook Pro' },
      quantity: 1,
      price: '85000.00',
      totalPrice: '85000.00',
      taxDetails: { taxRate: '22' }
    }
  ],
  priceSummary: {
    subtotal: { amount: '85000.00' },
    shipping: { amount: '500.00' },
    tax: { amount: '18810.00' },
    total: { amount: '85500.00', currency: 'UYU' }
  },
  taxInfo: {
    taxIncludedInPrices: true,
    totalTax: '15409.84'
  }
};

/**
 * Orden cancelada
 * Resultado esperado: Nota de Credito
 */
const ordenCancelada = {
  id: 'wix-order-004',
  number: '1004',
  status: 'CANCELED',
  paymentStatus: 'REFUNDED',
  _createdDate: new Date(Date.now() - 86400000).toISOString(), // Ayer
  _updatedDate: new Date().toISOString(),
  billingInfo: {
    contactDetails: {
      firstName: 'Ana',
      lastName: 'Lopez',
      phone: '099777888'
    },
    address: {
      addressLine1: 'Bvar Espana 2800',
      city: 'Montevideo',
      subdivision: 'UY-MO',
      country: 'UY'
    }
  },
  buyerInfo: {
    email: 'ana.lopez@gmail.com',
    firstName: 'Ana',
    lastName: 'Lopez'
  },
  lineItems: [
    {
      id: 'item-005',
      productName: { translated: 'Zapatillas Running', original: 'Zapatillas' },
      quantity: 1,
      price: '3500.00',
      totalPrice: '3500.00',
      taxDetails: { taxRate: '22' }
    }
  ],
  priceSummary: {
    subtotal: { amount: '3500.00' },
    shipping: { amount: '200.00' },
    tax: { amount: '814.00' },
    total: { amount: '3700.00', currency: 'UYU' }
  }
};

// ============================================================
// WEBHOOKS MOCK
// ============================================================

/**
 * Webhook de orden aprobada
 */
const webhookOrdenAprobada = {
  eventType: 'wix.ecom.v1.order_approved',
  instanceId: 'instance-123',
  data: ordenConsumidorFinal,
  entityId: ordenConsumidorFinal.id
};

/**
 * Webhook de orden cancelada
 */
const webhookOrdenCancelada = {
  eventType: 'wix.ecom.v1.order_canceled',
  instanceId: 'instance-123',
  data: ordenCancelada,
  entityId: ordenCancelada.id
};

// ============================================================
// FUNCIONES HELPER
// ============================================================

/**
 * Generar orden aleatoria para testing
 */
function generarOrdenAleatoria(opciones = {}) {
  const id = `wix-test-${Date.now()}`;
  const monto = opciones.monto || Math.floor(Math.random() * 50000) + 500;

  return {
    id,
    number: String(Math.floor(Math.random() * 9000) + 1000),
    status: opciones.status || 'APPROVED',
    paymentStatus: opciones.paymentStatus || 'PAID',
    _createdDate: new Date().toISOString(),
    billingInfo: {
      contactDetails: {
        firstName: 'Test',
        lastName: 'User',
        ...(opciones.vatId && { vatId: opciones.vatId })
      },
      address: {
        addressLine1: 'Test Address 123',
        city: 'Montevideo',
        subdivision: 'UY-MO',
        country: 'UY'
      }
    },
    buyerInfo: {
      email: `test-${Date.now()}@test.com`,
      firstName: 'Test',
      lastName: 'User'
    },
    lineItems: [
      {
        id: 'test-item',
        productName: { translated: 'Producto Test' },
        quantity: 1,
        price: String(monto),
        totalPrice: String(monto),
        taxDetails: { taxRate: '22' }
      }
    ],
    priceSummary: {
      subtotal: { amount: String(monto) },
      shipping: { amount: '0' },
      total: { amount: String(monto), currency: 'UYU' }
    }
  };
}

/**
 * Simular JWT de webhook (sin firma real)
 * Solo para testing local
 */
function simularWebhookJWT(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = 'fake-signature-for-testing';

  return `${header}.${body}.${signature}`;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Ordenes mock
  ordenConsumidorFinal,
  ordenEmpresa,
  ordenMontoAlto,
  ordenCancelada,

  // Webhooks mock
  webhookOrdenAprobada,
  webhookOrdenCancelada,

  // Helpers
  generarOrdenAleatoria,
  simularWebhookJWT,

  // Coleccion de todas las ordenes
  ordenes: [
    ordenConsumidorFinal,
    ordenEmpresa,
    ordenMontoAlto,
    ordenCancelada
  ]
};
