# Guía de Inicio Rápido - Integración Wix ↔ Biller

## Requisitos Previos

- Node.js v18 o superior
- Cuenta en Wix con ecommerce activo
- Cuenta en Biller (test o producción)
- Servidor desplegado en Render (o similar)

---

## 1. Configuración Inicial

### Crear archivo `.env`

Copia `.env.example` a `.env` y configura las variables:

```bash
cp .env.example .env
```

Variables requeridas:

```env
# SERVIDOR
SERVER_PORT=3000
SERVER_PUBLIC_URL=https://tu-app.onrender.com

# BILLER
BILLER_ENVIRONMENT=test
BILLER_TOKEN=tu_token_de_biller
BILLER_EMPRESA_ID=123
BILLER_EMPRESA_RUT=219999990019
BILLER_EMPRESA_SUCURSAL=1

# WIX
WIX_CLIENT_ID=tu_client_id
WIX_CLIENT_SECRET=tu_client_secret
WIX_ACCESS_TOKEN=tu_access_token
WIX_REFRESH_TOKEN=tu_refresh_token
WIX_API_BASE_URL=https://www.wixapis.com
WIX_WEBHOOK_SECRET=tu_webhook_secret

# OPCIONES
WIX_INVOICE_DELIVERY_ENABLED=true
LOG_LEVEL=info
```

---

## 2. Despliegue en Render

### Paso 1: Crear servicio en Render

1. Ve a [render.com](https://render.com) y crea una cuenta
2. Conecta tu repositorio de GitHub
3. Crea un nuevo "Web Service"
4. Configura:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Health Check Path**: `/health`

### Paso 2: Configurar variables de entorno

En Render, agrega todas las variables de tu `.env` en la sección "Environment".

También puedes subir tu archivo `.env` como "Secret File".

### Paso 3: Desplegar

Render desplegará automáticamente cuando hagas push a tu repositorio.

Tu URL pública será algo como: `https://tu-app.onrender.com`

### Verificar que está corriendo

```bash
curl https://tu-app.onrender.com/health
```

Deberías ver:
```json
{
  "status": "ok",
  "service": "Wix-Biller Integration v3",
  "biller": { "connected": true }
}
```

---

## 3. Autenticación con Wix

Define el método de autenticación según tu app:

- **OAuth**: Usa Client ID/Secret y guarda access/refresh tokens.
- **API Key**: Guarda la API Key en variables de entorno y usa headers.

Guarda las credenciales en tu `.env`.

---

## 4. Configurar Webhooks en Wix

1. En Wix Developers, crea y configura tu app.
2. Agrega la URL del webhook: `https://tu-app.onrender.com/webhooks/wix`
3. Suscribe eventos de orden (creada/pagada/cancelada/reembolsada).

---

## 5. Flujos Automáticos

### Facturación (cuando alguien compra)

```
Compra en Wix → Webhook order.created/paid → Emitir factura en Biller → Obtener PDF → Guardar link/nota en Wix
```

El comprador verá la factura en su historial de compras (como en tu captura).

### Notas de Crédito (cuando hay devolución)

```
Cancelación/Reembolso → Webhook order.canceled/refunded → Buscar factura original → Emitir NC en Biller
```

---

## 6. Endpoints Útiles

| Endpoint | Descripción |
|----------|-------------|
| `GET /` | Info del servicio |
| `GET /health` | Estado de salud |
| `GET /dashboard` | Dashboard visual |
| `GET /metrics` | Métricas Prometheus |
| `GET /api/comprobantes` | Lista de comprobantes |
| `GET /api/notas-credito` | Lista de notas de crédito |
| `GET /api/dashboard` | Datos del dashboard (JSON) |
| `POST /api/reconciliation/run` | Ejecutar reconciliación Wix ↔ Biller |
| `POST /api/reprocesar-orden/:orderId` | Reprocesar orden (útil si no llegó webhook) |
| `POST /api/emitir-nc/:orderId` | Forzar emisión de NC para una orden |

### Emitir NC manualmente para una orden cancelada

```bash
# Para la orden 2000010597823859:
curl -X POST https://tu-app.onrender.com/api/emitir-nc/2000010597823859
```

Esto buscará la factura original en Biller y emitirá la NC correspondiente.

---

## 7. Monitoreo

### Dashboard Web

Abre en tu navegador:
```
https://tu-app.onrender.com/dashboard
```

### Ver logs en tiempo real

En Render, ve a la sección "Logs" de tu servicio para ver los logs en tiempo real.

### Métricas para Prometheus

```
https://tu-app.onrender.com/metrics
```

---

## 8. Producción

### Cambiar a ambiente de producción de Biller

En las variables de entorno de Render:
```env
BILLER_ENVIRONMENT=production
BILLER_TOKEN=tu_token_de_produccion
```

### Auto-deploy

Render despliega automáticamente cuando haces push a tu repositorio.
Puedes desactivar esto en la configuración si prefieres despliegues manuales.

---

## 9. Troubleshooting

### El PDF no se guarda en Wix

1. Verifica que `WIX_INVOICE_DELIVERY_ENABLED=true` en las variables de entorno
2. Revisa los logs en Render para ver errores del worker
3. Verifica que el token de Wix sea válido

### Los webhooks no llegan

1. Verifica que `SERVER_PUBLIC_URL` sea correcto en las variables de entorno
2. Verifica que la URL de webhooks en Wix apunte a tu servidor de Render
3. Prueba el endpoint manualmente:
   ```bash
   curl -X POST https://tu-app.onrender.com/webhooks/wix \
     -H "Content-Type: application/json" \
     -d '{"eventType":"test","resourceId":"123"}'
   ```

### Error de token expirado

Si usas OAuth en Wix:
1. Verifica refresh token y permisos
2. Vuelve a autorizar la app si es necesario

### La factura no se emite

1. Verifica conexión con Biller: `curl https://tu-app.onrender.com/health`
2. Revisa que `BILLER_TOKEN` y `BILLER_EMPRESA_ID` sean correctos
3. Verifica los logs para ver el error específico

---

## 10. Estructura de Archivos de Datos

```
./data/
├── comprobantes.json    # Comprobantes emitidos
├── tokens.json          # Tokens de Wix (si aplica)
├── webhook-queue.json   # Cola de webhooks
└── errors.json          # Registro de errores
```

---

## Resumen de Comandos

```bash
# Desarrollo local
npm install                    # Instalar dependencias
npm start                      # Iniciar servidor (node server.js)

# Verificar salud del servidor
curl https://tu-app.onrender.com/health

# Ver dashboard
# Abre: https://tu-app.onrender.com/dashboard

# Ejecutar tests
npm test
```
