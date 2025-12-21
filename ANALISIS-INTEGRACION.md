# Analisis de Integracion Wix-Biller

Este documento analiza el flujo de facturacion y detecta problemas potenciales.

---

## Estado Actual: FUNCIONAL con mejoras recomendadas

La integracion esta bien estructurada. A continuacion el analisis por componente:

---

## 1. Wix Client (`wix-client.js`)

### Correcto

- Endpoint correcto: `GET /ecom/v1/orders/{orderId}` [Fuente](https://dev.wix.com/docs/rest/business-solutions/e-commerce/orders/get-order)
- Query endpoint correcto: `POST /ecom/v1/orders/query`
- OAuth endpoint correcto: `https://www.wix.com/oauth/access`
- Normalizacion de orden extrae campos correctos:
  - `billingInfo.contactDetails.vatId` para datos fiscales
  - `billingInfo.address` para direccion
  - `priceSummary` para montos
  - `lineItems` para items

### Problema Detectado: Estructura de Webhook JWT

El webhook de Wix NO viene con el payload en un campo `data.order`. Segun la [documentacion](https://dev.wix.com/docs/build-apps/develop-your-app/api-integrations/events-and-webhooks/handle-events-with-webhooks):

```javascript
// Estructura real del JWT decodificado:
{
  "data": {
    "order": { ... }  // La orden completa
  },
  "metadata": {
    "instanceId": "...",
    "eventType": "wix.ecom.v1.order_approved"
  }
}
```

**El codigo actual busca `payload.slug` pero deberia buscar `payload.metadata.eventType`.**

### Correccion Recomendada

```javascript
// En server.js linea 217
const { data, metadata } = payload;
const eventType = metadata?.eventType || payload.eventType;
const slug = eventType?.split('.').pop(); // "order_approved" -> "approved"
const orderId = data?.order?.id || payload.entityId;
```

---

## 2. Billing Decision (`billing-decision.js`)

### Correcto

- Regla 5000 UI implementada correctamente
- Mapeo de tipos de documento Wix -> Biller correcto
- Logica de decision clara:
  - RUT 12 digitos -> e-Factura (111)
  - Monto > 5000 UI con CI -> e-Ticket con receptor (101)
  - Monto bajo con CI -> e-Ticket con receptor (101)
  - Sin datos -> e-Ticket consumidor final (101)

### Observacion

El calculo de monto neto asume IVA 22%:
```javascript
const montoNeto = montoTotal / 1.22;
```

Esto es correcto para Uruguay donde el IVA es 22%.

---

## 3. Biller Client (`biller-client.js`)

### Correcto

- Estructura de comprobante segun API v2 de Biller
- Endpoints:
  - `POST /comprobantes/crear` - Emitir CFE
  - `GET /comprobantes` - Buscar por numero_interno
  - `POST /comprobantes/anular` - Anular (crear NC)
  - `GET /comprobantes/{id}/pdf` - Obtener PDF

### Estructura del Comprobante

La estructura enviada a Biller es correcta:

```javascript
{
  tipo_comprobante: 101,        // e-Ticket
  sucursal: 1,
  fecha_emision: "19/12/2024",  // formato dd/mm/aaaa
  numero_interno: "WIX-abc123",
  moneda: "UYU",
  montos_brutos: 1,             // precios con IVA
  forma_pago: 3,                // tarjeta
  items: [
    {
      concepto: "Producto",
      cantidad: 1,
      precio: 100.00,
      indicador_facturacion: 3  // gravado basica
    }
  ],
  cliente: "-"                  // consumidor final
  // O cliente con datos:
  cliente: {
    documento: "12345678",
    tipo_documento: 3,
    nombre_fantasia: "Juan Perez",
    pais: "UY"
  }
}
```

---

## 4. Credit Note Service (`credit-note-service.js`)

### Correcto

- Usa endpoint `/anular` de Biller (preferible a crear NC manual)
- Verifica idempotencia antes de emitir NC
- Mapeo correcto de tipos de NC:
  - 101 -> 102 (e-Ticket -> NC e-Ticket)
  - 111 -> 112 (e-Factura -> NC e-Factura)

---

## 5. Server Principal (`server.js`)

### Problema 1: Parsing de Webhook JWT

El webhook puede venir como:
1. Body raw (JWT string)
2. JSON parseado
3. Header `x-wix-signature`

**El codigo maneja los 3 casos, pero la extraccion de campos puede fallar.**

### Problema 2: Event Type vs Slug

La configuracion usa `slug` pero Wix envia `eventType` completo:
- Wix envia: `wix.ecom.v1.order_approved`
- Config espera: `approved` o `order_approved`

### Problema 3: Campo `data.order`

El webhook de Wix incluye la orden en `data.order`, pero si viene parcial, el codigo intenta obtenerla de la API. Esto es correcto.

---

## 6. Flujo Completo de Facturacion

```
1. Wix dispara webhook "order_approved"
   └── JWT con metadata.eventType y data.order

2. Server recibe en /webhooks/wix
   └── Verifica JWT (si hay public key)
   └── Extrae orderId y eventType

3. Si eventType es de emision (approved)
   └── Obtener orden completa (API si es necesario)
   └── Normalizar orden (extraer datos fiscales, items, montos)
   └── Verificar idempotencia (store local + Biller)
   └── Determinar tipo de comprobante (billing-decision)
   └── Preparar datos para Biller
   └── Emitir comprobante
   └── Guardar en store

4. Si eventType es de anulacion (canceled)
   └── Buscar comprobante original
   └── Anular via /anular de Biller
   └── Guardar NC en store
```

---

## 7. Problemas Identificados y Soluciones

### Problema A: Event Type Parsing

**Archivo**: `server.js` linea 217

**Actual**:
```javascript
const { id: eventId, slug, entityId, data } = payload;
```

**Solucion**:
```javascript
const { data, metadata } = payload;
const eventType = metadata?.eventType || payload.eventType || payload.slug;
// Extraer el slug final: "wix.ecom.v1.order_approved" -> "approved"
const slug = eventType?.split('.').pop()?.replace('order_', '');
const orderId = data?.order?.id || payload.entityId;
const eventId = metadata?.eventId || payload.id;
```

### Problema B: Config Webhook Events

**Archivo**: `config.js`

**Actual**:
```javascript
webhookEvents: {
  emitir: ['approved', 'order_approved'],
  anular: ['canceled', 'order_canceled', 'transactionsUpdated']
}
```

**Recomendacion**: Mantener ambos formatos por compatibilidad.

### Problema C: JWT Verification

Si `WIX_WEBHOOK_PUBLIC_KEY` no esta configurada, el sistema acepta webhooks sin verificar. Esto es un riesgo de seguridad en produccion.

**Solucion**: Advertir en logs y requerir en produccion.

---

## 8. Indicadores de Facturacion Biller

Segun documentacion Biller, los indicadores son:

| Codigo | Descripcion |
|--------|-------------|
| 1 | Exento de IVA |
| 2 | Gravado a tasa minima (10%) |
| 3 | Gravado a tasa basica (22%) |
| 4 | No gravado |
| 5 | Exportacion y asimilados |
| 6 | Impuesto percibido |
| 7 | IVA en suspenso |
| 10 | IVA otro |
| 11 | IVA tasa minima - anticipado |
| 12 | IVA tasa basica - anticipado |

**El codigo usa `3` (gravado basica 22%) que es correcto para ventas normales en Uruguay.**

---

## 9. Tipos de Documento Biller

| Codigo | Tipo |
|--------|------|
| 2 | RUT |
| 3 | CI |
| 4 | Otro |
| 5 | Pasaporte |
| 6 | DNI |
| 7 | NIFE |

**El mapeo en config.js es correcto.**

---

## 10. Recomendaciones Finales

1. **Alta Prioridad**: Corregir parsing de eventType en webhook
2. **Media Prioridad**: Agregar dependencia `jsonwebtoken` para verificacion JWT
3. **Baja Prioridad**: Agregar mas logging en flujo de facturacion

### Dependencias Faltantes

Agregar a package.json:
```json
{
  "dependencies": {
    "jsonwebtoken": "^9.0.0"
  }
}
```

---

## 11. Tests Recomendados

1. Webhook con orden aprobada -> e-Ticket
2. Webhook con orden aprobada + RUT empresa -> e-Factura
3. Webhook con orden cancelada -> NC
4. Orden > 5000 UI sin documento -> Warning
5. Orden > 5000 UI con CI -> e-Ticket con receptor

---

## Links de Documentacion

- [Wix eCommerce Orders API](https://dev.wix.com/docs/rest/business-solutions/e-commerce/orders/introduction)
- [Wix Order Object](https://dev.wix.com/docs/rest/business-solutions/e-commerce/orders/order-object)
- [Wix Webhooks](https://dev.wix.com/docs/build-apps/develop-your-app/api-integrations/events-and-webhooks/handle-events-with-webhooks)
- [Wix OAuth](https://dev.wix.com/docs/rest/app-management/oauth-2/introduction)
- [Biller API v2](https://documenter.getpostman.com/view/16327979/UUy1eSan)
- [Biller Ayuda](https://ayuda.biller.uy/es/knowledge/facturaci%C3%B3n-por-api-rest)
