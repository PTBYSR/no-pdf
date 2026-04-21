const { default: makeWASocket, fetchLatestWaWebVersion, Browsers, initAuthCreds } = require('@whiskeysockets/baileys');

async function testConnection() {
    let state;
    try {
        const creds = require('./notifier_creds.json');
        state = { creds, keys: {} };
    } catch {
        state = { creds: initAuthCreds(), keys: {} };
    }

    const { version } = await fetchLatestWaWebVersion();

    const sock = makeWASocket({
        version,
        printQRInTerminal: true,
        browser: Browsers.ubuntu('Chrome'),
        auth: state,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === 'close') {
            const error = lastDisconnect.error;
            console.log('\n====================================');
            console.log('CONNECTION CLOSED ERROR DETAILS:');
            console.log('Status Code:', error?.output?.statusCode);
            console.log('Message:', error?.message);
            console.log('Full Error Object:', JSON.stringify(error, null, 2));
            console.log('====================================\n');
            process.exit(1);
        } else if (connection === 'open') {
            console.log('\n>>> CONNECTION OPEN! <<<\n');
            process.exit(0);
        }
    });

}

testConnection();
