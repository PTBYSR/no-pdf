const readline = require('readline');
const { io } = require("socket.io-client");
const qrcode = require('qrcode-terminal');

const API_URL = 'http://localhost:3000';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
    console.log('\n=============================================');
    console.log('       MANUAL ONBOARDING CLI TOOL');
    console.log('=============================================\n');

    try {
        // Step 1: Phone Number
        const phoneNumber = await askQuestion('Enter Parent Phone Number (e.g., 234...): ');
        console.log(`\n[LOG] Sending OTP to ${phoneNumber}...`);

        const loginRes = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber })
        });

        const loginData = await loginRes.json();
        if (!loginData.success) {
            console.error(`[ERROR] Failed to send OTP: ${loginData.error}`);
            process.exit(1);
        }
        console.log(`[LOG] OTP Sent successfully: ${loginData.message}`);

        // Step 2: Verify OTP
        const otp = await askQuestion('\nEnter OTP Code: ');
        console.log(`\n[LOG] Verifying OTP...`);

        const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber, otp })
        });

        const verifyData = await verifyRes.json();
        if (!verifyData.success) {
            console.error(`[ERROR] Verification Failed: ${verifyData.error}`);
            process.exit(1);
        }

        const userId = verifyData.userId;
        console.log(`[LOG] Login Successful! User ID: ${userId}`);

        // Step 3: Start Monitoring Session
        console.log(`\n[LOG] Starting Monitoring Session for Child Device...`);
        const startRes = await fetch(`${API_URL}/api/monitor/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, parentPhoneNumber: phoneNumber })
        });

        const startData = await startRes.json();
        if (!startData.success) {
            console.error(`[ERROR] Failed to start session: ${startData.error}`);
            process.exit(1);
        }
        console.log(`[LOG] Session Initialization Started. Connect WebSocket...`);

        // Step 4: Listen for QR Code via Socket.io
        const socket = io(API_URL);

        socket.on('connect', () => {
            console.log(`[LOG] Connected to WebSocket Server (ID: ${socket.id})`);
            console.log(`[LOG] Joining room: ${userId}`);
            socket.emit('join_room', userId);
        });

        socket.on('qr_code', (qr) => {
            console.log('\n[LOG] QR Code Received from server:');
            qrcode.generate(qr, { small: true });
            console.log('\n[ACTION] Scan this QR code with the Child\'s WhatsApp (Linked Devices)');
        });

        socket.on('status', (status) => {
            console.log(`\n[LOG] Session Status Update: ${status.toUpperCase()}`);
            if (status === 'connected') {
                console.log('\n=============================================');
                console.log('       ✅ MONITORING ACTIVE SUCCESS');
                console.log('=============================================');
                console.log('Press Ctrl+C to exit script (Monitoring continues on server).');
                // We keep running to see logs, or user can exit
            }
        });

    } catch (error) {
        console.error('[CRITICAL ERROR]', error);
        rl.close();
    }
}

main();
