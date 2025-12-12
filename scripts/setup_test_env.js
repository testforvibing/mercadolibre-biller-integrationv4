
const https = require('https');
const { getTokenManager } = require('../utils/token-manager');
require('dotenv').config();

// Config
const APP_ACCESS_TOKEN = process.env.ML_ACCESS_TOKEN; // Usamos el token actual solo para crear el test user
const SITE_ID = 'MLU'; // Uruguay

async function createNewFullTestEnvironment(token) {
    console.log('🚀 Iniciando configuración de entorno de prueba limpio...\n');

    // 1. Crear Nuevo Vendedor
    const seller = await createTestUser(token, SITE_ID);
    console.log('✅ 1. Vendedor creado:');
    console.log(`   User: ${seller.nickname}`);
    console.log(`   ID: ${seller.id}`);
    console.log(`   Pass: ${seller.password}`);

    // Para publicar necesitamos el token DEL VENDEDOR, no el de la App.
    // Como es test user, necesitamos obtener su token.
    // NOTA: Normalmente esto requiere OAuth flow, pero para test users a veces podemos asumir permisos
    // O necesitamos loguearnos.

    // Si no podemos publicar por API sin oauth, al menos te doy el usuario y pass
    // para que publiques manualmente.

    console.log('\n⚠️ IMPORTANTE: Para que la integración funcione con este nuevo vendedor,');
    console.log('debes actualizar el ML_USER_ID en tu archivo .env con:', seller.id);
    console.log('y reiniciar el servidor.');

    console.log('\n--- RESUMEN PARA TU PRUEBA ---');
    console.log('🛍️  NUEVO VENDEDOR (Úsalo para vender):');
    console.log('    Usuario:', seller.nickname);
    console.log('    Clave:', seller.password);
    console.log('    Link para publicar: https://www.mercadolibre.com.uy/publicar');

    console.log('\n🛒 TUS DATOS DE COMPRA (Ya los tienes):');
    console.log('    Usuario: TESTUSER156016677539379952');
    console.log('    Clave: eq2SoFnlPS');
}

function createTestUser(token, siteId) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.mercadolibre.com',
            path: `/users/test_user`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const user = JSON.parse(data);
                if (user.error) reject(user);
                else {
                    console.log('DEBUG COMPLETO USUARIO:', JSON.stringify(user, null, 2));
                    resolve(user);
                }
            });
        });

        req.write(JSON.stringify({ site_id: siteId }));
        req.end();
    });
}

// Ejecutar
// Necesitamos un token válido para crear usuarios. Usaremos el TokenManager.
async function main() {
    try {
        const tokenManager = getTokenManager();
        const accessToken = await tokenManager.ensureValidToken();
        await createNewFullTestEnvironment(accessToken); // Pasamos token actualizado aunque no se use en signature, se toma de closure, mejor pasar
    } catch (e) {
        console.error('Error:', e);
    }
}

main();
