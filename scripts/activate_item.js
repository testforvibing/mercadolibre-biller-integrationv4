
const https = require('https');
const { getTokenManager } = require('../utils/token-manager');

const ITEM_ID = 'MLU991655320';

async function activarItem() {
    console.log(`🔌 Intentando activar ítem ${ITEM_ID}...`);

    try {
        const tokenManager = getTokenManager();
        const accessToken = await tokenManager.ensureValidToken();

        const data = JSON.stringify({ status: 'active' });

        const options = {
            hostname: 'api.mercadolibre.com',
            path: `/items/${ITEM_ID}`,
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                const response = JSON.parse(body);
                console.log('\nRespuesta ML:', JSON.stringify(response, null, 2));

                if (response.status === 'active') {
                    console.log('\n✅ ¡ÍTEM ACTIVADO EXITOSAMENTE!');
                    console.log('👉 Intenta comprar de nuevo ahora.');
                } else {
                    console.log('\n❌ No se pudo activar. Estado actual:', response.status);
                }
            });
        });

        req.write(data);
        req.end();

    } catch (error) {
        console.error('Error:', error.message);
    }
}

activarItem();
