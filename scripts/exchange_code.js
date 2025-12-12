
// Removed unused require
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Override config with credentials if needed, or use loaded config
// Assuming config.js loads process.env correctly

async function exchangeCode(code) {
    console.log('🔄 Intercambiando código por token...');

    // We construct the manual request because the SDK setup might vary
    const client_id = config.mercadolibre.appId;
    const client_secret = config.mercadolibre.appSecret;
    const redirect_uri = config.mercadolibre.redirectUri;

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id,
        client_secret,
        code,
        redirect_uri
    });

    try {
        const response = await fetch('https://api.mercadolibre.com/oauth/token', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'content-type': 'application/x-www-form-urlencoded'
            },
            body: body
        });

        const data = await response.json();

        if (data.error) {
            console.error('❌ Error OAuth:', data);
            return;
        }

        console.log('✅ Token obtenido exitosamente!');

        // Save to ml-tokens.json
        const tokensFile = path.join(__dirname, '../data/ml-tokens.json');

        const tokenData = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            user_id: data.user_id,
            expires_in: data.expires_in,
            expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
            savedAt: new Date().toISOString()
        };

        fs.writeFileSync(tokensFile, JSON.stringify(tokenData, null, 2));
        console.log('💾 Token guardado en data/ml-tokens.json');
        console.log('ℹ️ Reinicia el servidor para aplicar cambios.');

    } catch (e) {
        console.error('Error:', e);
    }
}

// Get code from args
const code = process.argv[2];
if (!code) {
    console.error('Uso: node exchange_code.js <CODE>');
} else {
    exchangeCode(code);
}
