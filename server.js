require('dotenv').config();
const readline = require('readline');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, fetchLatestWaWebVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const cors = require('cors');
const bodyParser = require('body-parser');
const { analyzeMessage, summarizeActivity } = require('./detection_agent');

// --------------------------------------------------------------------------------
// Minimal Logger Setup
// --------------------------------------------------------------------------------
const reset = "\x1b[0m";
const bold = "\x1b[1m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const blue = "\x1b[34m";
const cyan = "\x1b[36m";
const red = "\x1b[31m";

let isOnboarding = false;

const log = {
    info: (msg) => { 
        if (!isOnboarding || msg.includes('[Child]')) {
            console.log(`${blue}[INFO]${reset} ${msg}`);
        }
    },
    success: (msg) => {
        if (!isOnboarding) console.log(`${green}[SUCCESS]${reset} ${msg}`);
    },
    warn: (msg) => {
        if (!isOnboarding) console.log(`${yellow}[WARN]${reset} ${msg}`);
    },
    error: (msg) => console.log(`${red}[ERROR]${reset} ${msg}`), // Always show errors
    alert: (msg) => console.log(`${red}${bold}[ALERT]${reset} ${msg}`), // Always show alerts
    step: (num, title) => console.log(`\n${bold}${cyan}STEP ${num}: ${title}${reset}`),
    pair: (title, code) => {
        console.log(`\n${bold}${blue}=== ${title} ===${reset}`);
        console.log(`${blue}🔑 CODE: ${bold}${code}${reset}`);
        console.log(`${blue}Enter this code on the target WhatsApp device.${reset}\n`);
    }
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

function updateStatus(botStatus, childStatus) {
    // console.log(`${cyan}[STATUS] Bot: ${botStatus} | Child: ${childStatus}${reset}`);
}

// --------------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------------

// --------------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const PARENT_NUMBER = process.env.PARENT_NUMBER?.replace(/[^0-9]/g, '');
const BOT_NUMBER = process.env.BOT_NUMBER?.replace(/[^0-9]/g, '');

let PARENT_JID = PARENT_NUMBER ? `${PARENT_NUMBER}@s.whatsapp.net` : null;
let PARENT_LID = null;

// Initialize Express & Socket.io
const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// MongoDB Client
const mongoClient = new MongoClient(MONGODB_URI);
let db;

// Singleton Notifier Instance
let notifierSock = null;

// Active Child Sessions: Map<userId, socket>
const activeChildSessions = new Map();
const lastQrMessageKeys = new Map(); // Store message keys for QR codes sent to parent

// Intro message template
const INTRO_MESSAGE = `👋 *Hello! I'm your Child Safety Bot* 🛡️\n\nI help you monitor your child's WhatsApp for suspicious messages.\n\n*Commands:*\n• \"Start\" or \"Add child\"\n• \"Activity\" or \"Report\"`;

// Helper: Start Notifier Bot (Singleton)
async function startNotifierBot() {
    log.info('Initializing Safety Bot (Notifier)...');

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_notifier');
    const { version } = await fetchLatestWaWebVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        auth: state,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !sock.authState.creds.registered) {
            if (BOT_NUMBER) {
                log.info(`Requesting pairing code for Bot: ${BOT_NUMBER}`);
                try {
                    let code = await sock.requestPairingCode(BOT_NUMBER);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    log.pair('SAFETY BOT PAIRING', code);
                } catch (err) {
                    log.error(`Bot pairing failed: ${err.message}`);
                }
            } else {
                log.warn('BOT_NUMBER missing in .env');
            }
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect.error)?.output?.statusCode;
            updateStatus('Disconnected', 'Unknown');
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => startNotifierBot(), 3000);
            }
        } else if (connection === 'open') {
            log.success('Safety Bot Online');
            updateStatus('Online', 'Monitoring...');
            notifierSock = sock;

            if (PARENT_JID) {
                sock.sendMessage(PARENT_JID, { text: `✅ *Bot is back online!*\n\n${INTRO_MESSAGE}` }).catch(() => {});
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const senderJid = msg.key.remoteJid;
            
            // Check if this is the first message from the parent we're expecting
            if (!PARENT_JID && !PARENT_LID) {
                log.warn(`[Security] No Parent Number set. Waiting for setup tool.`);
            }

            // Flexible Parent Check (Handles both JID and LID)
            let isAuthorized = !PARENT_JID || 
                                senderJid === PARENT_JID || 
                                (PARENT_LID && senderJid === PARENT_LID);

            if (!isAuthorized) {
                log.warn(`Security: Ignored message from unauthorized number: ${senderJid}`);
                // Debug info to help user
                log.info(`Waiting for message from: ${PARENT_JID || 'Setup Not Run'} or LID: ${PARENT_LID || 'Not Resolved'}`);
                return;
            }

            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            if (text) log.info(`Parent: "${text}"`);

            if (text.toLowerCase().includes('start') || text.toLowerCase().includes('add child')) {
                log.info(`Onboarding triggered by parent.`);
                
                // If we didn't have an LID yet and the parent sent this, learn it!
                if (senderJid.endsWith('@lid') && !PARENT_LID) {
                    PARENT_LID = senderJid;
                    log.success(`Learned Parent LID: ${PARENT_LID}`);
                }

                await sock.sendMessage(senderJid, { text: '🛡️ *Setting up child monitoring...*' });

                const parentId = senderJid.split('@')[0];
                const userId = `${parentId}_child`;

                startChildSession(userId, senderJid);
            } else if (text.toLowerCase().includes('activity') || text.toLowerCase().includes('report')) {
                const parentPhone = senderJid.split('@')[0];
                const userId = `${parentPhone}_child`;
                log.info(`Parent requested activity report.`);

                if (!db) {
                    await sock.sendMessage(senderJid, { text: "⚠️ Database not connected." });
                    return;
                }

                try {
                    const recentMessages = await db.collection('message_logs')
                        .find({ userId })
                        .sort({ timestamp: -1 })
                        .limit(20)
                        .toArray();

                    const summary = await summarizeActivity(recentMessages, text);
                    await sock.sendMessage(senderJid, { text: summary });
                } catch (e) {
                    log.error(`Failed to fetch activity: ${e.message}`);
                }
            } else if (text) {
                await sock.sendMessage(senderJid, { text: INTRO_MESSAGE });
            }
        }
    });
}

// Helper: Start Child Monitor Session (per User)
async function startChildSession(userId, parentJid, childNumber) {
    log.info(`[Child] Starting Session: ${userId}`);

    const authFolder = `auth_info_child_${userId}`;
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestWaWebVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        auth: state,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !sock.authState.creds.registered) {
            log.info(`[Child] New QR Code generated.`);
            
            // 1. Terminal Output (Keep as fallback)
            if (!childNumber) {
                qrcodeTerminal.generate(qr, { small: true });
            }

            // 2. Send to Parent's WhatsApp
            if (notifierSock && PARENT_JID) {
                try {
                    // Delete previous QR message if it exists
                    const prevKey = lastQrMessageKeys.get(userId);
                    if (prevKey) {
                        await notifierSock.sendMessage(PARENT_JID, { delete: prevKey }).catch(() => {});
                    }

                    // Generate QR Image Buffer
                    const qrBuffer = await QRCode.toBuffer(qr);

                    // Send new QR Message
                    const sentMsg = await notifierSock.sendMessage(PARENT_JID, {
                        image: qrBuffer,
                        caption: `📸 *Child Device Link Required*\n\nScan this QR code with the child's WhatsApp (Linked Devices) to begin monitoring.\n\n_Note: This code refreshes automatically._`
                    });

                    // Store key for next refresh
                    lastQrMessageKeys.set(userId, sentMsg.key);
                } catch (err) {
                    log.error(`Failed to send QR to parent: ${err.message}`);
                }
            }

            if (childNumber) {
                log.info(`[Child] Pairing Code for ${childNumber}:`);
                try {
                    let code = await sock.requestPairingCode(childNumber.replace(/[^0-9]/g, ''));
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    console.log(`\n  🔑  ${bold}${cyan}${code}${reset}\n`);
                    log.info("Enter this code on the Child's WhatsApp.");
                    
                    // Also send pairing code to parent via WhatsApp
                    if (notifierSock && PARENT_JID) {
                        await notifierSock.sendMessage(PARENT_JID, {
                            text: `🔑 *Child Pairing Code*\n\nCode: *${code}*\n\nEnter this code on the child's WhatsApp (Link with phone number).`
                        }).catch(() => {});
                    }
                } catch (err) {
                    log.error(`[Child] Pairing failed: ${err.message}`);
                }
            }
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startChildSession(userId, parentJid);
            else {
                activeChildSessions.delete(userId);
                updateStatus('Online', 'Disconnected');
            }
        } else if (connection === 'open') {
            log.success(`Child Device Connected: ${userId}`);
            updateStatus('Online', 'Monitoring Active');
            activeChildSessions.set(userId, sock);
            io.to(userId).emit('status', 'connected');

            // Cleanup QR message from parent's chat
            const prevKey = lastQrMessageKeys.get(userId);
            if (notifierSock && PARENT_JID && prevKey) {
                await notifierSock.sendMessage(PARENT_JID, { delete: prevKey }).catch(() => {});
                lastQrMessageKeys.delete(userId);
            }

            if (notifierSock && parentJid) {
                notifierSock.sendMessage(parentJid, { text: '✅ Child Device Connected Successfully!\nMonitoring is now active.' }).catch(() => {});
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const sender = msg.pushName || msg.key.remoteJid;
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

            if (text) {
                log.info(`[MSG] ${sender}: "${text}"`);
                if (db) {
                    db.collection('message_logs').insertOne({
                        userId, senderJid: msg.key.remoteJid, senderName: sender,
                        content: text, timestamp: new Date()
                    }).catch(() => {});
                }

                if (text.length > 5) {
                    const isUnsafe = await analyzeMessage(text);
                    if (isUnsafe) {
                        log.alert(`${sender}: "${text}"`);
                        if (notifierSock && parentJid) {
                            const alertMsg = `🚨 *SAFETY ALERT*\nSuspicious message detected!\nFrom: ${sender}\nContent: "${text}"`;
                            notifierSock.sendMessage(parentJid, { text: alertMsg }).catch(() => {});
                        }
                    }
                }
            }
        }
    });
}

// In-Memory Fallback Store
const memoryStore = {
    users: new Map()
};

async function upsertUserOTP(phoneNumber, otp, otpExpires) {
    if (db) {
        await db.collection('users').updateOne(
            { phoneNumber },
            { $set: { otp, otpExpires } },
            { upsert: true }
        );
    } else {
        let user = memoryStore.users.get(phoneNumber) || { phoneNumber };
        user.otp = otp;
        user.otpExpires = otpExpires;
        memoryStore.users.set(phoneNumber, user);
    }
}

async function verifyUserOTP(phoneNumber, otp) {
    if (db) {
        return await db.collection('users').findOne({ phoneNumber });
    } else {
        return memoryStore.users.get(phoneNumber);
    }
}

async function clearUserOTP(phoneNumber) {
    if (db) {
        await db.collection('users').updateOne({ phoneNumber }, { $unset: { otp: "", otpExpires: "" } });
    } else {
        const user = memoryStore.users.get(phoneNumber);
        if (user) {
            delete user.otp;
            delete user.otpExpires;
            memoryStore.users.set(phoneNumber, user);
        }
    }
}

// API Endpoints
app.post('/api/auth/login', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number required' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    try {
        await upsertUserOTP(phoneNumber, otp, Date.now() + 300000);
        if (notifierSock) {
            const targetJid = `${phoneNumber}@s.whatsapp.net`;
            await notifierSock.sendMessage(targetJid, { text: `Your Safety App Login Code: ${otp}` });
        }
        res.json({ success: true, message: 'OTP sent' });
    } catch (e) {
        res.status(500).json({ error: 'Internal error' });
    }
});

app.post('/api/auth/verify', async (req, res) => {
    const { phoneNumber, otp } = req.body;
    try {
        const user = await verifyUserOTP(phoneNumber, otp);
        if (user && user.otp === otp && Date.now() < user.otpExpires) {
            await clearUserOTP(phoneNumber);
            
            // Dynamically set Parent JID upon successful verification
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
            PARENT_JID = `${cleanNumber}@s.whatsapp.net`;
            
            // Try to resolve the LID for this number immediately
            try {
                const [result] = await notifierSock.onWhatsApp(cleanNumber);
                if (result && result.lid) {
                    PARENT_LID = result.lid;
                    log.success(`Resolved Parent LID: ${PARENT_LID}`);
                }
            } catch (err) {
                log.warn(`Could not resolve LID for parent number yet. It will be mapped on the first message.`);
            }

            log.success(`Session verified. Parent JID set to: ${PARENT_JID}`);

            const userId = user._id ? user._id.toString() : user.phoneNumber;
            res.json({ success: true, userId });
        } else {
            res.status(401).json({ error: 'Invalid or expired OTP' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Internal error' });
    }
});

app.post('/api/monitor/start', async (req, res) => {
    const { userId, parentJid, childNumber } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });
    startChildSession(userId, parentJid, childNumber).catch(err => log.error(err.message));
    res.json({ success: true, message: 'Session initialization started' });
});

app.post('/api/test-alert', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber required' });
    if (!notifierSock) return res.status(503).json({ error: 'Notifier Bot not connected yet' });
    const targetJid = `${phoneNumber.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        await notifierSock.sendMessage(targetJid, {
            text: `🚨 *TEST SAFETY ALERT* 🚨\nThis is a test alert from the Child Safety Bot.`
        });
        res.json({ success: true, message: `Test alert sent to ${phoneNumber}` });
    } catch (e) {
        res.status(500).json({ error: 'Failed to send test alert' });
    }
});

io.on('connection', (socket) => {
    socket.on('join_room', (userId) => {
        socket.join(userId);
    });
});

// --------------------------------------------------------------------------------
// Onboarding Flow Logic (Integrated)
// --------------------------------------------------------------------------------
async function runInteractiveOnboarding() {
    isOnboarding = true;
    console.log(`\n${bold}${blue}=============================================`);
    console.log(`🛡️  CHILD SAFETY BOT — SETUP`);
    console.log(`=============================================${reset}`);

    try {
        log.step(1, "Authentication");
        const phoneNumber = await askQuestion(`${bold}  Enter Parent Phone Number (e.g., 234...): ${reset}`);
        if (!phoneNumber) {
            isOnboarding = false;
            return;
        }

        const otpSent = await handleLoginRequest(phoneNumber);
        if (!otpSent) {
            isOnboarding = false;
            return;
        }

        const otp = await askQuestion(`${bold}  Enter the 6-digit OTP Code: ${reset}`);
        const userId = await handleVerifyRequest(phoneNumber, otp);
        
        if (!userId) {
            isOnboarding = false;
            return runInteractiveOnboarding();
        }

        log.step(2, "Link Child Device");
        const childNumber = await askQuestion(`${bold}  Enter Child Phone Number (or Enter for QR): ${reset}`);
        
        isOnboarding = false; // Re-enable logs before starting session
        log.info("Initializing connection...");
        await startChildSession(userId, PARENT_JID, childNumber);

    } catch (error) {
        log.error(`Onboarding Error: ${error.message}`);
    } finally {
        isOnboarding = false;
    }
}

async function handleLoginRequest(phoneNumber) {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    try {
        await upsertUserOTP(phoneNumber, otp, Date.now() + 300000);
        if (notifierSock) {
            const targetJid = `${phoneNumber.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
            await notifierSock.sendMessage(targetJid, { text: `🛡️ Your Child Safety App Login Code: ${otp}` });
            log.success(`OTP Sent successfully to ${phoneNumber} via WhatsApp.`);
            return true;
        } else {
            log.error("Safety Bot not ready. Wait a moment and try again.");
            return false;
        }
    } catch (e) {
        log.error(`Failed to send OTP: ${e.message}`);
        return false;
    }
}

async function handleVerifyRequest(phoneNumber, otp) {
    const user = await verifyUserOTP(phoneNumber, otp);
    if (user && user.otp === otp && Date.now() < user.otpExpires) {
        await clearUserOTP(phoneNumber);
        PARENT_JID = `${phoneNumber.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        log.success(`Login Successful! Parent set to: ${PARENT_JID}`);
        return user._id ? user._id.toString() : user.phoneNumber;
    } else {
        log.error("Invalid or expired OTP.");
        return null;
    }
}

async function init() {
    try {
        await mongoClient.connect();
        db = mongoClient.db('child_safety_app');
        log.success('Connected to MongoDB');
    } catch (err) {
        log.warn('MongoDB Failed. Using In-Memory mode.');
    }
    
    server.listen(PORT, () => {
        log.info(`Background API Server running on port ${PORT}`);
    });

    try {
        await startNotifierBot();
        
        // Wait for bot to be online before starting onboarding
        const checkOnline = setInterval(() => {
            if (notifierSock) {
                clearInterval(checkOnline);
                runInteractiveOnboarding();
            }
        }, 1000);

    } catch (err) {
        log.error(`Critical Error: ${err.message}`);
    }
}

init();
