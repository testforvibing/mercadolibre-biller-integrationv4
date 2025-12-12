# Integración MercadoLibre ↔ Biller (Uruguay)

Sistema que **factura automáticamente** las ventas de MercadoLibre utilizando [Biller](https://biller.uy) para la emisión de Comprobantes Fiscales Electrónicos (CFE) en Uruguay.

---

## ¿Qué hace esta integración?

1. **Recibe notificaciones** de ventas desde MercadoLibre (webhooks)
2. **Decide el tipo de comprobante** según normativa DGI:
   - **e-Factura** (111): Si el comprador tiene RUT de empresa
   - **e-Ticket** (101): Para consumidores finales
   - Cumple la regla de **5000 UI**: ventas mayores requieren identificación
3. **Emite el comprobante** en Biller automáticamente
4. **Sube el PDF** de la factura a la orden de MercadoLibre
5. **Emite Notas de Crédito** automáticamente cuando hay devoluciones/claims

---

## Requisitos Previos

Antes de usar esta integración necesitas:

### 1. Cuenta en Biller
- Registrarte en [biller.uy](https://biller.uy)
- Obtener tu **token de API**
- Tener tu **ID de empresa** y **RUT**

### 2. Aplicación de MercadoLibre
- Crear una aplicación en [developers.mercadolibre.com.uy](https://developers.mercadolibre.com.uy)
- Obtener **App ID** y **App Secret**
- Configurar los webhooks apuntando a tu servidor

### 3. URL Pública
- El servidor debe ser accesible desde internet para recibir webhooks
- Puedes usar [ngrok](https://ngrok.com) para desarrollo local

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/MateoFabregat/mercdolibre-biller-integrationv3.git
cd mercdolibre-biller-integrationv3

# 2. Instalar dependencias
npm install

# 3. Configurar credenciales (ver sección siguiente)
cp .env.example .env
# Editar .env con tus credenciales

# 4. Iniciar el servidor
node server-v3.js
```

---

## Configuración

Copia `.env.example` a `.env` y completa con tus credenciales:

```env
# Servidor
SERVER_PORT=3000
SERVER_PUBLIC_URL=https://tu-url.ngrok-free.app  # URL pública para webhooks

# Biller - Facturación Electrónica
BILLER_ENVIRONMENT=test                # 'test' o 'production'
BILLER_TOKEN=tu_token_de_biller
BILLER_EMPRESA_ID=123
BILLER_EMPRESA_RUT=219999990019        # RUT de 12 dígitos
BILLER_EMPRESA_SUCURSAL=1
BILLER_EMPRESA_NOMBRE=Tu Empresa

# MercadoLibre
ML_APP_ID=tu_app_id
ML_APP_SECRET=tu_app_secret
ML_ACCESS_TOKEN=token_oauth            # Se renueva automáticamente
ML_REFRESH_TOKEN=refresh_token
ML_USER_ID=tu_user_id
ML_COUNTRY=UY
```

### ¿Cómo obtener los tokens de MercadoLibre?

1. Ve a `https://tu-servidor/auth/mercadolibre` en tu navegador
2. Autoriza la aplicación en MercadoLibre
3. Los tokens se guardan automáticamente en `./data/tokens.json`

---

## Uso

### Iniciar el servidor

```bash
node server-v3.js
```

El servidor escuchará webhooks de MercadoLibre y procesará las ventas automáticamente.

### Endpoints Principales

| Endpoint | Descripción |
|----------|-------------|
| `GET /health` | Estado del servidor y conexión con Biller |
| `GET /dashboard` | Panel visual con métricas en tiempo real |
| `GET /api/dashboard` | Métricas en JSON |
| `GET /api/comprobantes` | Listar comprobantes emitidos |
| `GET /api/errors` | Ver errores registrados |
| `POST /api/reconciliation/run` | Ejecutar reconciliación ML ↔ Biller |
| `GET /metrics` | Métricas Prometheus |

### Dashboard

Accede a `http://localhost:3000/dashboard` para ver:
- Comprobantes emitidos (total, hoy, por tipo)
- Estado de webhooks y cola de procesamiento
- Errores recientes
- Estado de la integración con Biller

---

## Arquitectura

```
┌─────────────────┐     Webhook      ┌─────────────────┐
│   MercadoLibre  │ ───────────────► │     Servidor    │
│   (Venta nueva) │                  │   (server-v3)   │
└─────────────────┘                  └────────┬────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │ Decisión Fiscal │
                                    │ (billing-decision)│
                                    └────────┬────────┘
                                              │
                                              ▼
┌─────────────────┐                 ┌─────────────────┐
│     Biller      │ ◄────────────── │  Emitir CFE     │
│   (e-Factura)   │                 │ (biller-client) │
└────────┬────────┘                 └─────────────────┘
         │
         │ PDF
         ▼
┌─────────────────┐
│   MercadoLibre  │ ◄── Subir factura al pedido
│   (Adjuntar PDF)│
└─────────────────┘
```

---

## Estructura del Proyecto

```
├── server-v3.js              # Servidor principal y API REST
├── config.js                 # Configuración centralizada
├── biller-client.js          # Cliente para API de Biller
├── services/
│   ├── billing-decision.js   # Lógica de decisión fiscal (DGI)
│   ├── credit-note-service.js # Notas de crédito por devoluciones
│   └── reconciliation-service.js # Reconciliación ML ↔ Biller
├── workers/
│   ├── ml-invoice-uploader.js # Subida de PDFs a MercadoLibre
│   └── webhook-processor.js   # Procesamiento de cola de webhooks
├── utils/
│   ├── store.js              # Persistencia de comprobantes
│   ├── error-store.js        # Almacén de errores
│   ├── token-manager.js      # Auto-refresh de tokens ML
│   ├── circuit-breaker.js    # Protección contra caídas
│   └── webhook-queue.js      # Cola persistente de webhooks
├── public/
│   └── dashboard.html        # Dashboard visual
└── data/                     # Datos persistentes (auto-generado)
    ├── comprobantes.json
    ├── tokens.json
    └── errors.json
```

---

## Características Técnicas

- **Cola Persistente**: Los webhooks se guardan en disco. Si el servidor se reinicia, no se pierden ventas.
- **Auto-Refresh de Tokens**: Los tokens de MercadoLibre se renuevan automáticamente antes de expirar.
- **Circuit Breaker**: Si Biller falla repetidamente, el sistema entra en modo protección para no saturar.
- **Idempotencia**: Una venta nunca genera comprobantes duplicados.
- **Reconciliación**: Verifica que todos los comprobantes locales existan en Biller.
- **Métricas Prometheus**: Integración con sistemas de monitoreo.

---

## Compartir con Otro Usuario

Para que otra persona use esta integración con **su propia cuenta**, solo necesita:

1. Clonar el repositorio
2. Copiar `.env.example` a `.env`
3. Completar con **sus propias credenciales**:
   - Credenciales de su cuenta Biller
   - Credenciales de su aplicación MercadoLibre
   - Su URL pública (ngrok u otro)
4. Ejecutar `npm install && node server-v3.js`

No se comparte ningún código sensible - todas las credenciales están en variables de entorno.

---

## Soporte

- **Issues**: [GitHub Issues](https://github.com/MateoFabregat/mercdolibre-biller-integrationv3/issues)
- **Documentación Biller**: [biller.uy/docs](https://biller.uy/docs)
- **API MercadoLibre**: [developers.mercadolibre.com.uy](https://developers.mercadolibre.com.uy)

---

## Licencia

Privado. Todos los derechos reservados.
