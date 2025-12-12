
const { getTokenManager } = require('../utils/token-manager');
const https = require('https');

async function checkItem() {
    try {
        const tokenManager = getTokenManager();
        const accessToken = await tokenManager.ensureValidToken();

        const options = {
            hostname: 'api.mercadolibre.com',
            path: '/items/MLU991707342?include_attributes=all',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(data);
            });
        });
        req.end();
    } catch (e) {
        console.error(e);
    }
}
checkItem();
