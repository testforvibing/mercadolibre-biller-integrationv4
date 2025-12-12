
const https = require('https');
const { getTokenManager } = require('../utils/token-manager');

const ITEM_ID = 'MLU991655320';

async function arreglarYActivar() {
    console.log(`🚑 Reparando ítem ${ITEM_ID}...`);

    try {
        const tokenManager = getTokenManager();
        const accessToken = await tokenManager.ensureValidToken();

        // 1. Cambiar foto por una segura (Logo ML)
        console.log('🖼️  Actualizando imagen...');
        const nuevaFoto = {
            pictures: [{ source: "https://http2.mlstatic.com/frontend-assets/ml-web-navigation/ui-navigation/5.21.22/mercadolibre/logo__large_plus.png" }]
        };

        await updateItem(ITEM_ID, nuevaFoto, accessToken);

        // Esperar 5 seg
        console.log('⏳ Esperando procesamiento...');
        await new Promise(r => setTimeout(r, 5000));

        // 2. Activar
        console.log('🔌 Activando...');
        await updateItem(ITEM_ID, { status: 'active' }, accessToken);

    } catch (error) {
        console.error('Error:', error.message);
    }
}

function updateItem(id, data, token) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.mercadolibre.com',
            path: `/items/${id}`,
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                const response = JSON.parse(body);
                if (response.status === 'active') console.log('✅ ¡ACTIVADO!');
                else console.log('ℹ️ Estado:', response.status);
                resolve(response);
            });
        });

        req.write(JSON.stringify(data));
        req.end();
    });
}

arreglarYActivar();
