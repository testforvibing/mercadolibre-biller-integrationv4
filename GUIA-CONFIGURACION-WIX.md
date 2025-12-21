# Guia Completa: Configurar Wix para Testing

Esta guia te explica paso a paso como crear una tienda de prueba en Wix, obtener las credenciales de API y configurar los webhooks para probar la integracion con Biller.

---

## Parte 1: Crear Cuenta y Tienda en Wix

### Paso 1.1: Crear cuenta de Wix

1. Ve a [wix.com](https://www.wix.com)
2. Click en "Comenzar" o "Get Started"
3. Crea una cuenta con email o Google/Facebook
4. Selecciona "Tienda Online" cuando te pregunte que tipo de sitio quieres

### Paso 1.2: Crear tienda eCommerce

1. Elige una plantilla de tienda (cualquiera sirve para testing)
2. Wix te guiara por el wizard de configuracion
3. **Importante**: Activa "Wix Stores" si no viene incluido
   - Ve a tu dashboard > Apps > Wix App Market
   - Busca "Wix Stores" e instalalo

### Paso 1.3: Configurar productos de prueba

1. Dashboard > Store Products > Products
2. Agrega algunos productos de prueba:
   - Producto 1: "Test Basico" - $500 UYU
   - Producto 2: "Test Premium" - $5000 UYU
   - Producto 3: "Test Grande" - $50000 UYU (para probar regla 5000 UI)

### Paso 1.4: Configurar metodos de pago (modo test)

1. Dashboard > Settings > Accept Payments
2. Activa "Pagos manuales" o "Efectivo" para testing
3. Esto te permite aprobar ordenes manualmente sin tarjeta real

---

## Parte 2: Crear App en Wix Developers

### Paso 2.1: Acceder a Wix Developers

1. Ve a [dev.wix.com](https://dev.wix.com)
2. Inicia sesion con la misma cuenta de Wix
3. Click en "Create New App" o "My Apps" > "Create App"

### Paso 2.2: Configurar la App

1. **Nombre**: "Biller Integration" (o lo que quieras)
2. **App Type**: Selecciona "Dashboard App" o "Backend/Webhook"
3. Click "Create App"

### Paso 2.3: Obtener App ID y Secret Key

1. En tu app, ve a "OAuth" en el menu lateral
2. Aqui encontraras:
   - **App ID** (tambien llamado Client ID)
   - **App Secret Key** (click en "Show" para verlo)

3. **COPIA ESTOS VALORES** - los necesitaras para el `.env`:
   ```
   WIX_CLIENT_ID=tu-app-id-aqui
   WIX_CLIENT_SECRET=tu-secret-key-aqui
   ```

### Paso 2.4: Configurar permisos (Scopes)

1. Ve a "Permissions" en el menu lateral
2. Agrega los siguientes permisos:
   - `ECOM.READ_ORDERS` - Leer ordenes
   - `ECOM.MANAGE_ORDERS` - Gestionar ordenes
   - `ECOM.READ_CATALOG` - Leer productos (opcional)

3. Guarda los cambios

---

## Parte 3: Instalar App en tu Sitio

### Paso 3.1: Instalar la app

1. En Wix Developers, ve a "Test Your App"
2. Click en "Test on a free site" o selecciona tu tienda
3. Autoriza los permisos cuando te lo pida

### Paso 3.2: Obtener tokens OAuth

**Opcion A: Usando el servidor (recomendado)**

1. Asegurate de que tu servidor este corriendo
2. Ve a: `https://tu-servidor.onrender.com/auth/wix`
3. Autoriza la app
4. Copia los tokens que aparecen en pantalla

**Opcion B: Manualmente desde Wix**

1. En Wix Developers > tu app > OAuth
2. Genera un "Test Token" si esta disponible
3. O sigue el flujo OAuth manualmente:

```
URL de autorizacion:
https://www.wix.com/installer/install?appId=TU_APP_ID&redirectUrl=TU_REDIRECT_URL
```

### Paso 3.3: Guardar tokens

Agrega a tu `.env`:
```
WIX_ACCESS_TOKEN=el-access-token
WIX_REFRESH_TOKEN=el-refresh-token
WIX_SITE_ID=el-site-id (lo ves en la URL de tu dashboard)
```

---

## Parte 4: Configurar Webhooks

### Paso 4.1: Acceder a configuracion de webhooks

1. En Wix Developers > tu app > "Webhooks"
2. Click en "Add Webhook"

### Paso 4.2: Agregar webhook de ordenes

**Webhook 1: Orden Aprobada**
- Event: `wix.ecom.v1.order_approved`
- O busca: "Order Approved" en eCommerce
- Callback URL: `https://tu-servidor.onrender.com/webhooks/wix`

**Webhook 2: Orden Cancelada** (para notas de credito)
- Event: `wix.ecom.v1.order_canceled`
- O busca: "Order Canceled"
- Callback URL: `https://tu-servidor.onrender.com/webhooks/wix`

### Paso 4.3: Obtener Webhook Public Key

1. En la seccion de Webhooks, busca "Public Key"
2. Copia la clave publica
3. Agregala a tu `.env`:
   ```
   WIX_WEBHOOK_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----
   ...tu clave...
   -----END PUBLIC KEY-----"
   ```

**Nota**: Si no configuras la public key, el servidor aceptara webhooks sin verificar firma (solo para desarrollo).

---

## Parte 5: Probar la Integracion

### Paso 5.1: Verificar conexion

```bash
# Verificar que el servidor este corriendo
curl https://tu-servidor.onrender.com/health

# Deberia mostrar:
{
  "status": "ok",
  "biller": { "conectado": true },
  "wix": { "conectado": true }
}
```

### Paso 5.2: Crear orden de prueba

1. Ve a tu tienda Wix (la URL publica)
2. Agrega un producto al carrito
3. Completa el checkout:
   - Email: cualquiera
   - Direccion: Uruguay
   - Pago: Manual/Efectivo

### Paso 5.3: Aprobar la orden

1. Dashboard Wix > Store Orders
2. Encuentra tu orden de prueba
3. Marca como "Pagada" o "Completada"
4. Esto disparara el webhook

### Paso 5.4: Verificar factura

```bash
# Ver comprobantes emitidos
curl https://tu-servidor.onrender.com/api/comprobantes

# Ver dashboard
# Abre: https://tu-servidor.onrender.com/dashboard
```

---

## Parte 6: Probar Diferentes Escenarios

### Escenario 1: e-Ticket consumidor final
- Compra normal sin datos fiscales
- Monto bajo (< $30,000 UYU)
- **Resultado**: e-Ticket (101) sin receptor

### Escenario 2: e-Ticket con receptor (monto alto)
- Producto de $50,000+ UYU
- Agregar CI en notas del pedido: "CI: 12345678"
- **Resultado**: e-Ticket (101) con receptor identificado

### Escenario 3: e-Factura empresa
- En checkout, agregar:
  - Empresa: "Mi Empresa SA"
  - RUT: 212222220019 (formato de 12 digitos)
- **Resultado**: e-Factura (111)

### Escenario 4: Nota de Credito
1. Crea una orden y espera que se facture
2. Cancela la orden en Wix
3. **Resultado**: NC automatica

---

## Parte 7: Troubleshooting

### El webhook no llega

1. Verifica que la URL sea correcta y accesible
2. Revisa logs en Render
3. Prueba manualmente:
   ```bash
   curl -X POST https://tu-servidor.onrender.com/webhooks/wix \
     -H "Content-Type: application/json" \
     -d '{"test": true}'
   ```

### Error de autorizacion

1. Verifica que los tokens no hayan expirado
2. Renueva tokens: `POST /api/tokens/refresh`
3. Si falla, re-autoriza en `/auth/wix`

### La factura no se emite

1. Verifica conexion con Biller en `/health`
2. Revisa que `BILLER_TOKEN` sea correcto
3. Verifica logs para ver el error especifico

### Error "Order not found"

1. Verifica que `WIX_ACCESS_TOKEN` tenga permisos
2. El token puede haber expirado (duran 4 horas)
3. Renueva con `/api/tokens/refresh`

---

## Resumen de Variables de Entorno

```env
# SERVIDOR
SERVER_PORT=3000
SERVER_PUBLIC_URL=https://tu-app.onrender.com

# BILLER
BILLER_ENVIRONMENT=test
BILLER_TOKEN=tu_token_biller
BILLER_EMPRESA_ID=123
BILLER_EMPRESA_RUT=219999990019
BILLER_EMPRESA_SUCURSAL=1
BILLER_EMPRESA_NOMBRE=Mi Empresa

# WIX - Credenciales App
WIX_CLIENT_ID=tu_app_id
WIX_CLIENT_SECRET=tu_app_secret

# WIX - Tokens OAuth
WIX_ACCESS_TOKEN=token_de_acceso
WIX_REFRESH_TOKEN=token_de_refresco
WIX_SITE_ID=site_id_de_tu_tienda

# WIX - Webhook (opcional pero recomendado)
WIX_WEBHOOK_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----..."

# OPCIONES
LOG_LEVEL=debug
```

---

## Links Utiles

- **Wix Developers**: https://dev.wix.com
- **Wix eCommerce API**: https://dev.wix.com/docs/rest/business-solutions/e-commerce/orders/introduction
- **Wix OAuth**: https://dev.wix.com/docs/rest/app-management/oauth-2/introduction
- **Biller Test**: https://test.biller.uy
- **Biller Docs**: https://biller.uy/docs
