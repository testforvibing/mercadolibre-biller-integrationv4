
const { getTokenManager } = require('../utils/token-manager');
const https = require('https');

async function getSellerInfo() {
    try {
        const tokenManager = getTokenManager();
        const accessToken = await tokenManager.ensureValidToken();

        const options = {
            hostname: 'api.mercadolibre.com',
            path: '/users/me',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                const user = JSON.parse(data);
                console.log('\n--- DATOS DEL VENDEDOR CONFIGURADO ---');
                console.log('ID:', user.id);
                console.log('Usuario (Nickname):', user.nickname);
                console.log('Email:', user.email);
                console.log('Link Perfil:', user.permalink);
                console.log('--------------------------------------\n');
            });
        });

        req.end();

    } catch (error) {
        console.error('Error:', error.message);
    }
}

getSellerInfo();
