const readline = require('readline');
const { io } = require("socket.io-client");
const qrcode = require('qrcode-terminal');

const API_URL = 'http://localhost:3000';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

// ANSI Colors
const reset = "\x1b[0m";
const bold = "\x1b[1m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const blue = "\x1b[34m";
const cyan = "\x1b[36m";
const red = "\x1b[31m";

const log = {
    step: (num, title) => console.log(`\n${bold}${cyan}STEP ${num}: ${title}${reset}`),
    info: (msg) => console.log(`  ${blue}ℹ${reset} ${msg}`),
    success: (msg) => console.log(`  ${green}✔${reset} ${msg}`),
    error: (msg) => console.log(`  ${red}✖${reset} ${msg}`),
    action: (msg) => console.log(`\n  ${bold}${yellow}👉 ${msg}${reset}`),
};

async function main() {
    console.clear();
    console.log(`${bold}${blue}=============================================`);
    console.log(`🛡️  CHILD SAFETY BOT — ONBOARDING`);
    console.log(`=============================================${reset}`);

    try {
        // Step 1: Phone Number
        log.step(1, "Authentication");
        const phoneNumber = await askQuestion(`${bold}  Enter Parent Phone Number (e.g., 234...): ${reset}`);
        
        process.stdout.write(`  ${blue}⏳ Sending OTP to ${phoneNumber}...${reset}\r`);
        const loginRes = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber })
        });

        const loginData = await loginRes.json();
        if (!loginData.success) {
            log.error(`Failed to send OTP: ${loginData.error}`);
            process.exit(1);
        }
        log.success(`OTP Sent successfully to WhatsApp.`);

        // Step 2: Verify OTP
        const otp = await askQuestion(`${bold}  Enter the 6-digit OTP Code: ${reset}`);
        
        process.stdout.write(`  ${blue}⏳ Verifying...${reset}\r`);
        const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber, otp })
        });

        const verifyData = await verifyRes.json();
        if (!verifyData.success) {
            log.error(`Verification Failed: ${verifyData.error}`);
            process.exit(1);
        }

        const userId = verifyData.userId;
        log.success(`Login Successful!`);

        // Step 3: Start Monitoring Session
        log.step(2, "Initialize Child Device");
        const childNumber = await askQuestion(`${bold}  Enter Child Phone Number (or press Enter for QR): ${reset}`);
        
        log.info(`Requesting monitoring session...`);
        
        const startRes = await fetch(`${API_URL}/api/monitor/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userId, 
                parentJid: `${phoneNumber}@s.whatsapp.net`,
                childNumber: childNumber || null
            })
        });

        const startData = await startRes.json();
        if (!startData.success) {
            log.error(`Failed to start session: ${startData.error}`);
            process.exit(1);
        }
        log.success(`Session Initialized.`);

        // Step 4: Listen for QR Code via Socket.io
        log.step(3, "Link WhatsApp");
        log.info("Connecting to secure server channel...");
        const socket = io(API_URL);

        socket.on('connect', () => {
            socket.emit('join_room', userId);
        });

        socket.on('qr_code', (qr) => {
            console.log(`\n${bold}  SCAN THIS QR CODE WITH THE CHILD'S WHATSAPP:${reset}`);
            qrcode.generate(qr, { small: true });
            log.action("Open WhatsApp > Linked Devices > Link a Device");
        });

        socket.on('pairing_code', (code) => {
            console.log(`\n${bold}  ENTER THIS PAIRING CODE ON THE CHILD'S WHATSAPP:${reset}`);
            console.log(`\n  🔑  ${bold}${cyan}${code}${reset}\n`);
            log.action("Open WhatsApp > Linked Devices > Link with phone number instead");
        });

        socket.on('status', (status) => {
            if (status === 'connected') {
                console.log(`\n${bold}${green}=============================================`);
                console.log(`✅  MONITORING ACTIVE SUCCESS`);
                console.log(`=============================================${reset}`);
                log.info("You can now close this terminal.");
                log.info("The server will continue monitoring in the background.");
                rl.close();
                socket.disconnect();
                process.exit(0);
            } else {
                log.info(`Status: ${status.toUpperCase()}`);
            }
        });

    } catch (error) {
        log.error(`Critical Error: ${error.message}`);
        rl.close();
    }
}

main();
