# Guía de Inicio Rápido - Integración MercadoLibre ↔ Biller

## Requisitos Previos

- Node.js v18 o superior
- Cuenta de vendedor en MercadoLibre Uruguay
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

# MERCADOLIBRE
ML_APP_ID=tu_app_id
ML_APP_SECRET=tu_app_secret
ML_USER_ID=tu_user_id
ML_COUNTRY=UY

# OPCIONES
ML_INVOICE_UPLOAD_ENABLED=true
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
   - **Start Command**: `node server-v3.js`
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
  "service": "MercadoLibre-Biller Integration v3",
  "biller": { "connected": true }
}
```

---

## 3. Autorización OAuth con MercadoLibre

### Primera vez (obtener tokens)

1. Abre en tu navegador:
   ```
   https://tu-app.onrender.com/auth/mercadolibre
   ```

2. Inicia sesión con tu cuenta de MercadoLibre

3. Acepta los permisos

4. Serás redirigido de vuelta y verás "Autorización exitosa"

Los tokens se guardan automáticamente en `./data/ml-tokens.json`.

---

## 4. Configurar Webhooks en MercadoLibre

### Opción A: Usando la API de ML (recomendado)

```bash
curl -X POST "https://api.mercadolibre.com/applications/TU_APP_ID/notifications" \
  -H "Authorization: Bearer TU_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://tu-app.onrender.com/webhooks/mercadolibre",
    "topics": ["orders_v2", "claims"]
  }'
```

### Opción B: Desde el panel de desarrolladores

1. Ve a https://developers.mercadolibre.com.uy
2. Entra a tu aplicación
3. Configura la URL de webhooks: `https://tu-app.onrender.com/webhooks/mercadolibre`
4. Selecciona los topics: `orders_v2`, `claims`

---

## 5. Flujos Automáticos

### Facturación (cuando alguien compra)

```
Compra en ML → Webhook orders_v2 → Emitir factura en Biller → Obtener PDF → Subir a ML
```

El comprador verá la factura en su historial de compras (como en tu captura).

### Notas de Crédito (cuando hay devolución)

```
Devolución/Cancelación → Webhook claims → Buscar factura original → Emitir NC en Biller
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
| `POST /api/reconciliation/run` | Ejecutar reconciliación |
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

### El PDF no se sube a MercadoLibre

1. Verifica que `ML_INVOICE_UPLOAD_ENABLED=true` en las variables de entorno
2. Revisa los logs en Render para ver errores del worker
3. Verifica que el token de ML sea válido

### Los webhooks no llegan

1. Verifica que `SERVER_PUBLIC_URL` sea correcto en las variables de entorno
2. Verifica que la URL de webhooks en ML apunte a tu servidor de Render
3. Prueba el endpoint manualmente:
   ```bash
   curl -X POST https://tu-app.onrender.com/webhooks/mercadolibre \
     -H "Content-Type: application/json" \
     -d '{"topic":"test","resource":"/test/123"}'
   ```

### Error de token expirado

El sistema renueva tokens automáticamente. Si falla:
1. Elimina `./data/ml-tokens.json`
2. Vuelve a autorizar en `/auth/mercadolibre`

### La factura no se emite

1. Verifica conexión con Biller: `curl https://tu-app.onrender.com/health`
2. Revisa que `BILLER_TOKEN` y `BILLER_EMPRESA_ID` sean correctos
3. Verifica los logs para ver el error específico

---

## 10. Estructura de Archivos de Datos

```
./data/
├── comprobantes.json    # Comprobantes emitidos
├── ml-tokens.json       # Tokens de MercadoLibre
├── webhook-queue.json   # Cola de webhooks
└── errors.json          # Registro de errores
```

---

## Resumen de Comandos

```bash
# Desarrollo local
npm install                    # Instalar dependencias
node server-v3.js              # Iniciar servidor

# Verificar salud del servidor
curl https://tu-app.onrender.com/health

# Ver dashboard
# Abre: https://tu-app.onrender.com/dashboard
```
