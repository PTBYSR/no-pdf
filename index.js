/**
 * ⚠️ DEPRECATED — This is the old standalone version.
 * Use `node server.js` instead for the full dynamic onboarding system.
 * This file is kept for reference only.
 */
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestWaWebVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { analyzeMessage } = require('./detection_agent');

// Configuration
const PARENT_NUMBER = '2347066499537@s.whatsapp.net'; // Parent's number for alerts
let notifierSock = null; // Holds the notifier socket instance

// Reusable function to start a socket
async function startSocket(authFolder, isMonitor) {
    return new Promise(async (resolve, reject) => {
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        const role = isMonitor ? 'CHILD MONITOR' : 'NOTIFIER BOT';

        console.log(`\n===================================================`);
        console.log(`Starting ${role} instance...`);
        console.log(`===================================================\n`);

        const { version, isLatest } = await fetchLatestWaWebVersion();
        console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`);

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ['Ubuntu', 'Chrome', '110.0.0'],
            auth: state,
        });

        // Flag to tracking if we have already resolved the promise for this socket
        // This prevents the promise from being resolved multiple times if 'open' fires more than once
        let isResolved = false;

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(`\nScan QR for ${role}:`);
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const error = lastDisconnect?.error;
                const statusCode = error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(`${role} connection closed. Status Code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

                if (shouldReconnect) {
                    // Reconnect logic
                    startSocket(authFolder, isMonitor).then(newSock => {
                        if (!isMonitor) notifierSock = newSock;
                    });
                }
            } else if (connection === 'open') {
                console.log(`\n>>> ${role} CONNECTED SUCCESSFULLY! <<<\n`);

                // Only resolve the MAIN promise once
                if (!isResolved) {
                    isResolved = true;
                    resolve(sock);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Only the Monitor instance listens for messages
        if (isMonitor) {
            sock.ev.on('messages.upsert', async (m) => {
                const msg = m.messages[0];
                if (!msg.key.fromMe && m.type === 'notify') {
                    const sender = msg.pushName || msg.key.remoteJid;
                    const text = msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption || '';

                    const isProtocol = msg.message?.protocolMessage || msg.message?.senderKeyDistributionMessage;

                    if (!isProtocol) {
                        const messageType = Object.keys(msg.message || {})[0] || 'unknown';
                        console.log(`\n[CHILD MONITOR] New Message from ${sender}: ${text || `[${messageType}]`}`);

                        // SAFETY ANALYSIS
                        if (text && text.length > 5) {
                            console.log(`Analyzing message for safety...`);
                            const isUnsafe = await analyzeMessage(text);

                            if (isUnsafe) {
                                console.log('\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
                                console.log('!!! ALERT: POTENTIAL PEDOPHILIC BEHAVIOR DETECTED !!!');
                                console.log(`!!! SENDER: ${sender}`);
                                console.log(`!!! CONTENT: "${text}"`);
                                console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n');

                                // Send Alert via Notifier Bot
                                if (notifierSock) {
                                    const alertMessage = `🚨 *SAFETY ALERT* 🚨\n\n` +
                                        `Suspicious message detected on child's device!\n` +
                                        `From: ${sender}\n` +
                                        `Content: "${text}"`;

                                    try {
                                        await notifierSock.sendMessage(PARENT_NUMBER, { text: alertMessage });
                                        console.log(`[NOTIFIER BOT] Alert sent to parent (${PARENT_NUMBER})`);
                                    } catch (err) {
                                        console.error(`[NOTIFIER BOT] Failed to send alert:`, err);
                                    }
                                } else {
                                    // If notifier isn't ready, we could optionally try to send from child's phone
                                    // but we strictly want separate channels as requested
                                    console.log('[SYSTEM] Notifier bot not connected, could not send alert.');
                                }
                            } else {
                                // console.log('Message analysis: SAFE');
                            }
                        }
                    }
                }
            });
        }
    });
}

// Sequential Initialization
async function initSystem() {
    try {
        console.log('\n*** INITIALIZING DUAL-INSTANCE SAFETY SYSTEM ***\n');

        // 1. Start Child Monitor (Wait for connection)
        await startSocket('auth_info_child', true);

        console.log('\n---------------------------------------------------');
        console.log('Child Monitor ready. Initializing Notifier Bot...');
        console.log('---------------------------------------------------\n');

        // 2. Start Notifier Bot (Wait for connection)
        notifierSock = await startSocket('auth_info_notifier', false);

        console.log('\n*** SYSTEM FULLY OPERATIONAL ***');
        console.log('Monitoring and Alerting active.\n');

    } catch (err) {
        console.error('Initialization failed:', err);
    }
}

// Start the system
initSystem();
