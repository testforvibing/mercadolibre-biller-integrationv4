# Despliegue en Render

Guia paso a paso para desplegar la integracion Wix-Biller en Render.

## Paso 1: Subir a GitHub

```bash
# Inicializar repositorio si no existe
git init

# Agregar archivos
git add .

# Crear commit
git commit -m "Initial commit: Wix-Biller integration"

# Crear repositorio en GitHub (si usas gh CLI)
gh repo create wix-biller-integration --private --source=. --push

# O si ya tienes el repo, solo push
git push origin main
```

## Paso 2: Crear Servicio en Render

1. Ve a [https://dashboard.render.com](https://dashboard.render.com)
2. Click en **New +** > **Web Service**
3. Conecta tu cuenta de GitHub si no lo has hecho
4. Selecciona el repositorio `wix-biller-integration`
5. Render detectara automaticamente el `render.yaml`

### Configuracion Basica:

| Campo | Valor |
|-------|-------|
| Name | wix-biller-integration |
| Region | Oregon (us-west) |
| Branch | main |
| Runtime | Node |
| Build Command | npm install |
| Start Command | npm start |
| Plan | Free (o Starter para produccion) |

## Paso 3: Variables de Entorno

En Render Dashboard, ve a **Environment** y configura estas variables:

### Obligatorias - Biller

```
BILLER_TOKEN=tu_token_biller
BILLER_EMPRESA_ID=123
BILLER_EMPRESA_RUT=219999990019
BILLER_EMPRESA_SUCURSAL=1
BILLER_EMPRESA_NOMBRE=Tu Empresa
BILLER_ENVIRONMENT=test   # Cambiar a "production" en produccion
```

### Obligatorias - Wix

```
WIX_CLIENT_ID=tu_client_id
WIX_CLIENT_SECRET=tu_client_secret
WIX_WEBHOOK_SECRET=tu_webhook_secret
```

### Opcionales (se configuran despues de OAuth)

```
WIX_ACCESS_TOKEN=
WIX_REFRESH_TOKEN=
WIX_TOKEN_EXPIRES_AT=
WIX_SITE_ID=
```

### Para Auto-Renovacion de Tokens (Recomendado)

```
RENDER_API_KEY=rnd_xxxxxxxxxxxxx
RENDER_SERVICE_ID=srv-xxxxxxxxxxxxx
```

Para obtener estos valores:
- **RENDER_API_KEY**: Dashboard > Account Settings > API Keys
- **RENDER_SERVICE_ID**: Es el ID en la URL de tu servicio (srv-xxxxxxxx)

## Paso 4: Desplegar

1. Click en **Create Web Service**
2. Espera a que el deploy termine (2-3 minutos)
3. Tu URL sera algo como: `https://wix-biller-integration.onrender.com`

## Paso 5: Verificar Deploy

Visita estas URLs para verificar:

```
https://tu-app.onrender.com/         # Info del servicio
https://tu-app.onrender.com/health   # Health check
https://tu-app.onrender.com/dashboard  # Dashboard visual
```

## Paso 6: Configurar OAuth de Wix

1. Ve a `https://tu-app.onrender.com/auth/wix`
2. Autoriza la app en tu tienda Wix
3. Copia los tokens que aparecen en la pagina de callback
4. Actualiza las variables de entorno en Render:
   - `WIX_ACCESS_TOKEN`
   - `WIX_REFRESH_TOKEN`
   - `WIX_TOKEN_EXPIRES_AT`

## Paso 7: Configurar Webhooks en Wix

1. Ve a tu app en [Wix Developers](https://dev.wix.com/)
2. En la seccion **Webhooks**, agrega:
   - Event: `eCommerce Orders Approved`
   - URL: `https://tu-app.onrender.com/webhooks/wix`
3. Guarda la **Webhook Public Key** si Wix la proporciona

## Endpoints Disponibles

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/` | GET | Info del servicio |
| `/health` | GET | Health check |
| `/webhooks/wix` | POST | Receptor de webhooks |
| `/auth/wix` | GET | Iniciar OAuth |
| `/auth/wix/callback` | GET | Callback OAuth |
| `/api/comprobantes` | GET | Listar comprobantes |
| `/api/notas-credito` | GET | Listar NCs |
| `/api/dashboard` | GET | Datos del dashboard |
| `/api/tokens` | GET | Estado de tokens |
| `/api/tokens/refresh` | POST | Renovar token |
| `/dashboard` | GET | Dashboard HTML |
| `/metrics` | GET | Metricas Prometheus |

## Troubleshooting

### El servidor no inicia
- Verifica que todas las variables obligatorias esten configuradas
- Revisa los logs en Render Dashboard

### Error de token Wix
- Re-autoriza en `/auth/wix`
- Verifica que `WIX_CLIENT_ID` y `WIX_CLIENT_SECRET` sean correctos

### Webhooks no llegan
- Verifica la URL del webhook en Wix Dashboard
- El servidor debe estar corriendo (no dormido)
- El plan Free de Render duerme despues de 15 min de inactividad

### Plan Free vs Starter
| Caracteristica | Free | Starter ($7/mes) |
|----------------|------|------------------|
| Sleep despues de inactividad | 15 min | Nunca |
| Tiempo de arranque | ~30 seg | Instantaneo |
| Recomendado para | Testing | Produccion |

## Notas Importantes

1. **Ambiente de pruebas**: Usa `BILLER_ENVIRONMENT=test` hasta que todo funcione
2. **Backups**: Los datos se guardan en archivos JSON en `/data`. En Render Free, estos se pierden al reiniciar.
3. **Tokens Wix**: Expiran cada 4 horas. Configura `RENDER_API_KEY` para auto-renovacion.
