# Wix-Biller Integration

Sistema que **factura automaticamente** las ventas de Wix utilizando [Biller](https://biller.uy) para la emision de Comprobantes Fiscales Electronicos (CFE) en Uruguay.

## Que hace esta integracion?

1. **Recibe webhooks** de Wix cuando se aprueba/cancela una orden
2. **Decide el tipo de comprobante** segun normativa DGI:
   - **e-Factura** (111): Si el comprador tiene RUT de empresa
   - **e-Ticket** (101): Para consumidores finales
   - Cumple la regla de **5000 UI**: ventas mayores requieren identificacion
3. **Emite el comprobante** en Biller automaticamente
4. **Emite Notas de Credito** automaticamente cuando hay cancelaciones o reembolsos

## Requisitos

- Node.js 18+
- Cuenta en [Biller](https://biller.uy) (test o produccion)
- App de Wix con permisos de eCommerce

## Instalacion

```bash
npm install
cp .env.example .env
# Editar .env con tus credenciales
npm start
```

## Configuracion

Copia `.env.example` a `.env` y completa:

```env
# Servidor
SERVER_PORT=3000
SERVER_PUBLIC_URL=https://tu-app.onrender.com

# Biller
BILLER_ENVIRONMENT=test
BILLER_TOKEN=tu_token
BILLER_EMPRESA_ID=123
BILLER_EMPRESA_RUT=219999990019
BILLER_EMPRESA_SUCURSAL=1

# Wix
WIX_CLIENT_ID=tu_client_id
WIX_CLIENT_SECRET=tu_client_secret
WIX_ACCESS_TOKEN=tu_access_token
WIX_REFRESH_TOKEN=tu_refresh_token
WIX_SITE_ID=tu_site_id
```

## Wix OAuth Flow

1. Ir a `/auth/wix` para iniciar autorizacion
2. Autorizar la app en Wix
3. Callback a `/auth/wix/callback`
4. Guardar los tokens mostrados en variables de entorno

## Webhooks

Configurar en Wix Dashboard -> App -> Webhooks:

- **URL**: `https://tu-app.onrender.com/webhooks/wix`
- **Eventos**:
  - `wix.ecom.v1.order_approved` - Emitir CFE
  - `wix.ecom.v1.order_canceled` - Emitir NC

## API Endpoints

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/` | GET | Info del servicio |
| `/health` | GET | Health check |
| `/webhooks/wix` | POST | Recibir webhooks |
| `/auth/wix` | GET | Iniciar OAuth |
| `/api/comprobantes` | GET | Listar comprobantes |
| `/api/dashboard` | GET | Estadisticas |
| `/api/tokens` | GET | Estado de tokens |
| `/api/tokens/refresh` | POST | Renovar token |
| `/api/reprocesar-orden/:id` | POST | Reprocesar orden |
| `/api/emitir-nc/:id` | POST | Forzar NC |
| `/metrics` | GET | Metricas Prometheus |
| `/dashboard` | GET | Dashboard HTML |

## Reglas de Facturacion

### e-Ticket (101)
- Ventas a consumidor final
- Monto <= 5000 UI: Sin identificacion

### e-Ticket con Receptor
- Monto > 5000 UI: Requiere documento

### e-Factura (111)
- Cliente con RUT empresa (12 digitos)

## Despliegue en Render

1. Crear Web Service
2. **Build Command**: `npm install`
3. **Start Command**: `node server.js`
4. **Health Check Path**: `/health`
5. Configurar variables de entorno
6. Webhook URL: `https://tu-servicio.onrender.com/webhooks/wix`

## Arquitectura

```
Wix (Venta nueva)
       |
       v Webhook JWT
+------+--------+
|   Servidor    |
|   (server.js) |
+-------+-------+
        |
        v
+---------------+
| billing-      |
| decision.js   |
+-------+-------+
        |
        v
+---------------+      +---------------+
| biller-       | ---> |    Biller     |
| client.js     |      |  (e-Factura)  |
+---------------+      +---------------+
```

## Estructura del Proyecto

```
.
├── server.js              # Servidor principal
├── config.js              # Configuracion
├── wix-client.js          # Cliente API Wix
├── biller-client.js       # Cliente API Biller
├── services/
│   ├── billing-decision.js    # Logica de facturacion
│   └── credit-note-service.js # Notas de credito
├── utils/
│   ├── logger.js              # Logging
│   ├── store.js               # Persistencia
│   ├── wix-token-manager.js   # Gestion de tokens
│   └── ...
└── public/
    └── dashboard.html         # Dashboard visual
```

## Caracteristicas Tecnicas

- **Cola Persistente**: Webhooks se guardan en disco
- **Circuit Breaker**: Proteccion ante fallos de Biller
- **Idempotencia**: Sin comprobantes duplicados
- **Metricas Prometheus**: Para monitoreo

## Documentacion

- [Wix eCommerce Orders API](https://dev.wix.com/docs/rest/business-solutions/e-commerce/orders/introduction)
- [Wix OAuth 2.0](https://dev.wix.com/docs/rest/app-management/oauth-2/introduction)
- [Wix Webhooks](https://dev.wix.com/docs/build-apps/develop-your-app/api-integrations/events-and-webhooks/handle-events-with-webhooks)
- [Biller API](https://biller.uy/docs)

## Licencia

MIT
# wix-biller-integracion
