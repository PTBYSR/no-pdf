require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode'); // For generating Image Buffers
const qrcodeTerminal = require('qrcode-terminal'); // For Terminal QR
const cors = require('cors');
const bodyParser = require('body-parser');

const { analyzeMessage, summarizeActivity } = require('./detection_agent');
// We will use file-based auth for the singleton notifier for simplicity/stability first
// and MongoDB for the dynamic child sessions

// Configuration
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// Initialize Express & Socket.io
const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for now (adjust for production)
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

// Helper: Start Notifier Bot (Singleton)
async function startNotifierBot() {
    console.log('--- Starting Singleton Notifier Bot ---');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_notifier');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // Using manual printing
        auth: state,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('--- Scan this QR to link the DETECTOR BOT ---');
            qrcodeTerminal.generate(qr, { small: true });

            // Also save as PNG file for easier scanning
            QRCode.toFile('./notifier_qr.png', qr, { type: 'png' }, function (err) {
                if (err) console.error('Error saving QR image:', err);
                else console.log('✅ QR Code also saved to "notifier_qr.png". Open this file if terminal scan fails.');
            });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Notifier Bot closed. Reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) {
                startNotifierBot();
            }
        } else if (connection === 'open') {
            console.log('>>> NOTIFIER BOT ONLINE <<<');
            notifierSock = sock;
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const senderJid = msg.key.remoteJid;
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

            console.log(`[Notifier] Message from ${senderJid}: "${text}"`);

            // Chat-Based Onboarding Trigger
            if (text.toLowerCase().includes('start safety') || text.toLowerCase().includes('add child') || text === 'Start') {
                console.log(`[Notifier] Received Onboarding Command from ${senderJid}`);

                await sock.sendMessage(senderJid, { text: 'Welcome to Child Safety! 🛡️\nSetting up your secure session...' });

                // Use sender's phone number as the User ID (e.g. 23480..._child)
                const parentPhone = senderJid.split('@')[0];
                const userId = `${parentPhone}_child`;

                // Track last sent QR message to delete it before sending new one
                let lastQrMessageKey = null;

                // Start Child Session with QR Callback
                startChildSession(userId, parentPhone, async (qrString) => {
                    console.log(`[Notifier] Sending QR Code to ${senderJid}`);
                    try {
                        // 1. Delete Previous QR if exists
                        if (lastQrMessageKey) {
                            await sock.sendMessage(senderJid, { delete: lastQrMessageKey });
                        }

                        // 2. Generate QR Buffer
                        const qrBuffer = await QRCode.toBuffer(qrString);

                        // 3. Send Image to Parent with Caption
                        const sentMsg = await sock.sendMessage(senderJid, {
                            image: qrBuffer,
                            caption: "Scan this code with your Child's device (Linked Devices) to start monitoring.\n\n⏳ *QR Code expires in 20 seconds...*"
                        });

                        // 4. Save Key for next deletion
                        lastQrMessageKey = sentMsg.key;

                    } catch (e) {
                        console.error('[Notifier] Failed to send QR:', e);
                        await sock.sendMessage(senderJid, { text: 'Error generating QR code. Please try again.' });
                    }
                });

            } else if (text.toLowerCase().includes('activity') ||
                text.toLowerCase().includes('who messaged') ||
                text.toLowerCase().includes('last message') ||
                text.toLowerCase().includes('report') ||
                text.toLowerCase().includes('last person') ||
                (text.toLowerCase().includes('who') && text.toLowerCase().includes('text'))) {

                // RAG: Activity Summary
                const parentPhone = senderJid.split('@')[0];
                const userId = `${parentPhone}_child`;
                console.log(`[Notifier] Activity Query for child: ${userId}`);

                if (!db) {
                    await sock.sendMessage(senderJid, { text: "⚠️ Database not connected. Cannot fetch history." });
                    return;
                }

                try {
                    // 1. Fetch last 20 messages for this child
                    const recentMessages = await db.collection('message_logs')
                        .find({ userId })
                        .sort({ timestamp: -1 })
                        .limit(20)
                        .toArray();

                    // 2. Summarize with LLM
                    const summary = await summarizeActivity(recentMessages, text);

                    // 3. Reply
                    await sock.sendMessage(senderJid, { text: summary });

                } catch (e) {
                    console.error('[Notifier] Failed to fetch activity:', e);
                    await sock.sendMessage(senderJid, { text: "⚠️ Error fetching activity logs." });
                }
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Helper: Start Child Monitor Session (per User)
async function startChildSession(userId, parentPhoneNumber, onQR) {
    console.log(`Starting Child Session for User: ${userId}`);

    // In a real app, use useMongoDBAuthState here. 
    // For this prototype, we'll use a unique file folder per user to guarantee stability 
    // before switching complex Mongo adapter logic.
    // const { state, saveCreds } = await useMongoDBAuthState(db.collection('sessions'), userId);

    const authFolder = `auth_info_child_${userId}`;
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    // Custom Silent Logger to suppress "Closing session" noise
    const silentLogger = pino({ level: 'silent' });

    const sock = makeWASocket({
        logger: silentLogger,
        printQRInTerminal: false, // We'll send QR via Socket.io
        auth: state,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            // Emit QR code to the specific user's frontend room
            io.to(userId).emit('qr_code', qr);
            console.log(`QR Code generated for user ${userId}`);

            // Callback for Chat-Based Onboarding
            if (onQR) {
                onQR(qr);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            // console.log(`Child Session ${userId} closed. Reconnecting: ${shouldReconnect}`);
            io.to(userId).emit('status', 'disconnected');

            if (shouldReconnect) {
                startChildSession(userId, parentPhoneNumber, onQR);
            } else {
                activeChildSessions.delete(userId);
            }
        } else if (connection === 'open') {
            console.log(`Child Session ${userId} CONNECTED!`);
            io.to(userId).emit('status', 'connected');
            activeChildSessions.set(userId, sock);

            // Notify Parent
            if (notifierSock && parentPhoneNumber) {
                const targetJid = parentPhoneNumber.includes('@') ? parentPhoneNumber : `${parentPhoneNumber}@s.whatsapp.net`;
                notifierSock.sendMessage(targetJid, { text: '✅ Child Device Connected Successfully!\nMonitoring is now active.' }).catch(console.error);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Message Listening Logic
    sock.ev.on('messages.upsert', async (m) => {
        // console.log(JSON.stringify(m, null, 2)); // DEBUG: Dump full event
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const sender = msg.pushName || msg.key.remoteJid;

            const text = msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption || '';

            console.log(`[Child Session ${userId}] Message from ${sender}: "${text}"`);

            // RAG: Log Message to MongoDB
            if (db && text) {
                const logData = {
                    userId,
                    senderJid: msg.key.remoteJid,
                    senderName: sender,
                    content: text,
                    timestamp: new Date()
                };
                db.collection('message_logs').insertOne(logData).catch(err => console.error('Failed to log message:', err));
            }

            if (text && text.length > 5) {
                const isUnsafe = await analyzeMessage(text);

                if (isUnsafe) {
                    console.log(`[ALERT] Unsafe content detected for User ${userId} from ${sender}`);

                    // Send Alert via Notifier Bot to the specific Parent
                    if (notifierSock && parentPhoneNumber) {
                        const alertMsg = `🚨 *SAFETY ALERT* 🚨\nSuspicous message on child's device!\nFrom: ${sender}\nContent: "${text}"`;
                        // Format number: '2347066499537' -> '2347066499537@s.whatsapp.net'
                        const targetJid = parentPhoneNumber.includes('@') ? parentPhoneNumber : `${parentPhoneNumber}@s.whatsapp.net`;

                        console.log(`[DEBUG] Attempting to send ALERT to Parent: ${targetJid}`); // DEBUG LOG

                        try {
                            await notifierSock.sendMessage(targetJid, { text: alertMsg });
                            console.log(`[DEBUG] ALERT sent successfully to ${targetJid}`); // DEBUG LOG
                        } catch (e) {
                            console.error('Failed to send alert:', e);
                        }
                    } else {
                        console.error(`[ERROR] Cannot send alert. NotifierSock: ${!!notifierSock}, ParentPhone: ${parentPhoneNumber}`);
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

// Helper to get user data (DB or Memory)
async function upsertUserOTP(phoneNumber, otp, otpExpires) {
    if (db) {
        await db.collection('users').updateOne(
            { phoneNumber },
            { $set: { otp, otpExpires } },
            { upsert: true }
        );
    } else {
        console.log('[WARN] MongoDB not connected. Using In-Memory Store.');
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

// --------------------------------------------------------------------------------
// API Endpoints
// --------------------------------------------------------------------------------

// 1. Send OTP (Simulated for Prototype)
app.post('/api/auth/login', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number required' });

    // Generate simulated OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`OTP for ${phoneNumber}: ${otp}`);

    // Store OTP
    try {
        await upsertUserOTP(phoneNumber, otp, Date.now() + 300000);
    } catch (e) {
        console.error('DB Error:', e);
        return res.status(500).json({ error: 'Database error' });
    }

    // Send OTP via WhatsApp Notifier (if available)
    if (notifierSock) {
        const targetJid = `${phoneNumber}@s.whatsapp.net`;
        try {
            await notifierSock.sendMessage(targetJid, { text: `Your Safety App Login Code: ${otp}` });
        } catch (e) {
            console.error('Could not send OTP via WhatsApp:', e);
        }
    }

    res.json({ success: true, message: 'OTP sent' });
});

// 2. Verify OTP
app.post('/api/auth/verify', async (req, res) => {
    const { phoneNumber, otp } = req.body;

    try {
        const user = await verifyUserOTP(phoneNumber, otp);

        if (user && user.otp === otp && Date.now() < user.otpExpires) {
            // Clear OTP
            await clearUserOTP(phoneNumber);
            // Return ID (use phone as ID for memory store if no _id)
            const userId = user._id ? user._id.toString() : user.phoneNumber;
            res.json({ success: true, userId });
        } else {
            res.status(401).json({ error: 'Invalid or expired OTP' });
        }
    } catch (e) {
        console.error('DB Error:', e);
        res.status(500).json({ error: 'Internal error' });
    }
});

// 3. Start Monitoring Session
app.post('/api/monitor/start', async (req, res) => {
    const { userId, parentPhoneNumber } = req.body; // In real app, get parentPhoneNumber from verified user record
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    // Start session async
    startChildSession(userId, parentPhoneNumber).catch(console.error);

    res.json({ success: true, message: 'Session initialization started' });
});

// Socket.io Connection Helper
io.on('connection', (socket) => {
    console.log('Frontend connected:', socket.id);

    // User joins their own room based on ID
    socket.on('join_room', (userId) => {
        socket.join(userId);
        console.log(`Socket ${socket.id} joined room ${userId}`);
    });
});

// Initialization
async function init() {
    try {
        await mongoClient.connect();
        db = mongoClient.db('child_safety_app');
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('------------------------------------------------');
        console.error('WARNING: Failed to connect to MongoDB.');
        console.error('Running in IN-MEMORY mode. Data will be lost on restart.');
        console.error('Error:', err.message);
        console.error('------------------------------------------------');
        // db remains undefined, endpoints will use fallback
    }

    // Start the Main Notifier Bot
    // We allow this to start even if DB fails
    try {
        await startNotifierBot();
    } catch (err) {
        console.error('Failed to start Notifier Bot:', err);
    }

    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

init();
