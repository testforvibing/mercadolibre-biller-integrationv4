
const https = require('https');
const { getTokenManager } = require('../utils/token-manager');

async function publicarItemAutomatico() {
    console.log('📦 Publicando ítem de prueba...');

    try {
        const tokenManager = getTokenManager();
        const accessToken = await tokenManager.ensureValidToken();

        const itemData = {
            title: "Item de Prueba Biller V3.2 " + Date.now(),
            category_id: "MLU3530", // Categoría genérica
            price: 500,
            currency_id: "UYU",
            available_quantity: 10,
            buying_mode: "buy_it_now",
            listing_type_id: "gold_special", // Exposición media
            condition: "new",
            attributes: [
                { id: "BRAND", value_name: "Marca Generica" },
                { id: "MODEL", value_name: "Modelo Prueba V3" }
            ],
            pictures: [
                { source: "https://http2.mlstatic.com/D_NQ_NP_933396-MLA42263886196_062020-O.jpg" }
            ]
        };

        const options = {
            hostname: 'api.mercadolibre.com',
            path: '/items',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                const response = JSON.parse(data);
                if (response.permalink) {
                    console.log('\n✅ ÍTEM CREADO EXITOSAMENTE:');
                    console.log('-------------------------------------------');
                    console.log('🔗 LINK PARA COMPRAR:', response.permalink);
                    console.log('🆔 ID:', response.id);
                    console.log('👤 Vendedor ID:', response.seller_id);
                    console.log('-------------------------------------------');
                    console.log('👉 Entra a ese link con el usuario COMPRADOR y compra.');
                } else {
                    console.error('❌ Error al publicar:', JSON.stringify(response, null, 2));
                }
            });
        });

        req.write(JSON.stringify(itemData));
        req.end();

    } catch (error) {
        console.error('Error:', error.message);
    }
}

publicarItemAutomatico();
