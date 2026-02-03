const { Client, LocalAuth } = require('whatsapp-web.js');
const { execFile, spawn } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

// Config
const {YOUR_PHONE} = '{YOUR_WHATSAPP_NUMBER}'; // Your Business WhatsApp Business (Google Voice)
const TEMP_DIR = path.join(__dirname, 'temp');
const LOG_FILE = path.join(__dirname, 'receptionist.log');

// Verbal password for execution commands (spoken or typed)
// Variations that Whisper might transcribe
const VERBAL_PASSWORDS = [
    'tunafish',
    'tuna fish',
    'tuna-fish',
    'tunafish please',
    'tuna',  // in case Whisper truncates
];

// Track authenticated sessions (resets after 10 minutes of inactivity)
let lastAuthTime = null;
const AUTH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function isAuthenticated() {
    if (!lastAuthTime) return false;
    if (Date.now() - lastAuthTime > AUTH_TIMEOUT_MS) {
        lastAuthTime = null;
        return false;
    }
    return true;
}

function checkForPassword(text) {
    const lower = text.toLowerCase().trim();
    for (const pwd of VERBAL_PASSWORDS) {
        if (lower.includes(pwd)) {
            lastAuthTime = Date.now();
            return true;
        }
    }
    return false;
}

// Initialize Anthropic client
const anthropic = new Anthropic();

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Alert User via WhatsApp
async function alertUser(message) {
    try {
        const userChat = await client.getChatById(`${{YOUR_PHONE}}@c.us`);
        await userChat.sendMessage(message);
        log(`🔔 Alert sent to User: ${message.substring(0, 50)}...`);
    } catch (error) {
        log(`⚠️ Failed to alert User: ${error.message}`);
    }
}

// System prompt for Claude - knows about User's setup
const SYSTEM_PROMPT = `You are User's AI assistant receptionist. User runs Your Business, a web development and AI consulting company.

When User sends you a voice message request, you should:
1. Understand what he's asking for
2. Determine if you can execute it or need clarification
3. Provide a clear, concise response

**What you CAN do (respond with actionable confirmation):**
- Acknowledge tasks and confirm understanding
- Provide information about his projects/clients
- Draft emails or messages
- Give status updates on what you know
- Schedule reminders or note tasks

**What requires external action (flag for execution):**
- Updating websites (flag: NEEDS_EXECUTION)
- Sending emails (flag: NEEDS_EXECUTION)
- Checking AWS/cloud resources (flag: NEEDS_EXECUTION)
- File operations (flag: NEEDS_EXECUTION)

**User's Projects:**
- support-forge.com - Main business site (GCP Cloud Run)
- vineyardvalais.com - Client site (Next.js on Amplify)
- witchsbroomcleaning.com - Client site (S3/CloudFront)
- sweetmeadow-bakery.com - Client site (Amplify)
- homebasevet.com - Client site (S3)

**Response Format:**
Keep responses SHORT (2-3 sentences max for WhatsApp).
If action needed: Start with ✅ or 📋
If clarification needed: Start with ❓
If error/can't do: Start with ⚠️

Example responses:
- "✅ Got it. I'll update the homepage images on vineyardvalais.com. Give me a few minutes."
- "❓ Which client site - Vineyard Valais or Sweetmeadow?"
- "📋 Noted: Follow up with Michael about the proposal tomorrow."`;

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.join(__dirname, '.wwebjs_receptionist_v3')  // Fresh session path
    }),
    puppeteer: {
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-background-networking',
            '--disable-extensions',
            '--user-data-dir=' + path.join(__dirname, '.wwebjs_receptionist_v3', 'chrome_profile')
        ]
    }
});

// Logging
function log(message) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}`;
    console.log(logLine);
    fs.appendFileSync(LOG_FILE, logLine + '\n');
}

log('🤖 Claude Receptionist starting...');

client.on('qr', (qr) => {
    log('QR Code needed - run: npm run auth');
});

client.on('ready', () => {
    console.log('');
    console.log('╔═══════════════════════════════════════════╗');
    console.log('║  🤖 CLAUDE RECEPTIONIST - LIVE & READY    ║');
    console.log('╚═══════════════════════════════════════════╝');
    console.log('');
    console.log('📱 WhatsApp: +1 {BUSINESS_PHONE} (Your Business Business)');
    console.log('🧠 Claude: Ready to process requests');
    console.log('📞 Calls: Auto-reject with voicemail prompt');
    console.log('');
    console.log('─'.repeat(50));
    log('Receptionist ready and listening');
});

// Debug: Log when any message event fires (fallback listener)
client.on('message', (message) => {
    log(`📨 [message event] from: ${message.from}, type: ${message.type}`);
});

// Debug: Log raw message events
client.on('message_ack', (message, ack) => {
    log(`✓ Message ACK: ${ack} for message to ${message.to}`);
});

// Debug: Log when media is received
client.on('media_uploaded', (message) => {
    log(`📎 Media uploaded: ${message.type}`);
});

// Handle incoming WhatsApp calls - auto-reject and prompt for voicemail
client.on('incoming_call', async (call) => {
    try {
        log(`📞 Incoming call from: ${call.from} (video: ${call.isVideo})`);

        // Reject the call
        await call.reject();
        log('📞 Call rejected');

        // Send voicemail prompt to the caller
        const chat = await client.getChatById(call.from);
        await chat.sendMessage(
            `📞 *Thanks for calling Your Business!*\n\n` +
            `Please leave a message or shoot us a text.`
        );
        log('📞 Voicemail prompt sent to caller');

        // Alert User about the missed call
        const callerContact = await client.getContactById(call.from);
        const callerName = callerContact.pushname || callerContact.name || 'Unknown';
        const callerNumber = call.from.replace('@c.us', '');
        await alertUser(`📞 *Missed Call*\nFrom: ${callerName} (${callerNumber})\nVideo: ${call.isVideo ? 'Yes' : 'No'}`);

    } catch (error) {
        log(`📞 Error handling call: ${error.message}`);
    }
});

// Use message_create to capture ALL messages (including from others)
client.on('message_create', async (message) => {
    try {
        // Log ALL messages for debugging
        log(`📩 Message event - from: ${message.from}, fromMe: ${message.fromMe}, type: ${message.type}, hasMedia: ${message.hasMedia}`);

        // Skip messages sent by us (to avoid loops)
        if (message.fromMe) {
            log(`⏭️ Skipping - sent by us`);
            return;
        }

        // Check if this is from User (for authenticated commands) or from someone else (voicemail)
        const senderId = message.from;
        const isFromUser = senderId.includes({YOUR_PHONE});
        const isVoicemail = !isFromUser; // Messages from others are treated as voicemails

        let userRequest = '';

        // Handle images with caption
        if (message.hasMedia && message.type === 'image') {
            log('🖼️ Image received');
            const caption = message.body || '';
            if (caption) {
                userRequest = `[Image attached] ${caption}`;
                log(`📝 Image caption: "${caption}"`);
            } else {
                await message.reply('📷 Got the image. What would you like me to do with it?');
                return;
            }
        }
        // Handle voice notes
        else if (message.hasMedia && (message.type === 'ptt' || message.type === 'audio')) {
            log('🎤 Voice note received' + (isVoicemail ? ' (VOICEMAIL)' : ''));

            // Download and transcribe
            const media = await message.downloadMedia();
            const timestamp = Date.now();
            const audioPath = path.join(TEMP_DIR, `voice_${timestamp}.ogg`);
            const wavPath = path.join(TEMP_DIR, `voice_${timestamp}.wav`);

            fs.writeFileSync(audioPath, Buffer.from(media.data, 'base64'));

            // Convert to WAV
            await new Promise((resolve, reject) => {
                execFile('ffmpeg', ['-i', audioPath, '-ar', '16000', '-ac', '1', wavPath, '-y'],
                    { timeout: 30000 }, (error) => {
                        if (error) reject(error);
                        else resolve();
                    });
            });

            // Transcribe
            log('🔄 Transcribing...');
            userRequest = await transcribeWithWhisper(wavPath);
            log(`📝 Transcribed: "${userRequest}"`);

            // Cleanup
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
            if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);

            if (userRequest.includes('[Transcription failed') || userRequest.includes('[Empty')) {
                await message.reply('⚠️ Couldn\'t understand that. Try again?');
                return;
            }

            // If this is a voicemail from someone else, handle differently
            if (isVoicemail) {
                const contact = await message.getContact();
                const callerName = contact.pushname || contact.name || 'Unknown';
                const callerNumber = senderId.replace('@c.us', '');

                log(`📬 VOICEMAIL from ${callerName} (${callerNumber}): "${userRequest}"`);

                // Acknowledge to the caller
                await message.reply(
                    `✅ *Message received!*\n\n` +
                    `Thanks for your message. Someone from Your Business will get back to you soon.`
                );

                // Alert User about the voicemail
                await alertUser(
                    `📬 *New Voicemail*\n` +
                    `From: ${callerName} (${callerNumber})\n` +
                    `Message: "${userRequest}"`
                );

                return;
            }
        }
        // Handle text messages
        else if (message.body) {
            userRequest = message.body.trim();

            // Skip simple commands
            if (['help', '?', 'status'].includes(userRequest.toLowerCase())) {
                await message.reply(
                    '🤖 *Claude Receptionist*\n\n' +
                    'Send a voice note or text to ask Claude anything.\n\n' +
                    '*To execute tasks*, say "tunafish" first, then:\n' +
                    '• "Update the homepage on vineyard valais"\n' +
                    '• "Check AWS costs"\n' +
                    '• "Deploy support-forge"\n\n' +
                    `Auth status: ${isAuthenticated() ? '🔓 Active' : '🔒 Locked'}`
                );
                return;
            }

            log(`💬 Text received: "${userRequest}"`);
        } else {
            return;
        }

        // Check for verbal password
        const passwordSpoken = checkForPassword(userRequest);
        if (passwordSpoken) {
            log('🔓 Password authenticated - session active for 10 minutes');
            await message.reply('🔓 *Authenticated.* Execution enabled for 10 minutes.\n\nWhat do you need?');
            return;
        }

        // Send to Claude for processing
        log('🧠 Processing with Claude...');
        await message.reply('🔄 Processing...');

        const response = await processWithClaude(userRequest, isAuthenticated());
        log(`🤖 Claude response: "${response}"`);

        // Send response back
        await message.reply(response);

        // Check if execution is needed and user is authenticated
        if (response.includes('NEEDS_EXECUTION')) {
            if (isAuthenticated()) {
                log('⚡ Executing task...');
                // Extract the task and execute via Claude Code
                const executionResult = await executeTask(userRequest);
                await message.reply(executionResult);
            } else {
                log('🔒 Execution blocked - not authenticated');
                await message.reply('🔒 *Authentication required*\n\nSay "tunafish" to enable execution mode for 10 minutes.');
            }
        }

    } catch (error) {
        log(`❌ Error: ${error.message}`);
        console.error(error);
        try {
            await message.reply('⚠️ Something went wrong. Try again?');
        } catch (e) {}
    }
});

async function transcribeWithWhisper(audioPath) {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, 'transcribe.py');
        const python = spawn('python', [scriptPath, audioPath, 'base']);

        let output = '';
        let errorOutput = '';

        python.stdout.on('data', (data) => {
            output += data.toString();
        });

        python.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        python.on('close', (code) => {
            if (code !== 0 || !output.trim()) {
                console.error('Whisper error:', errorOutput);
                resolve('[Transcription failed]');
            } else {
                resolve(output.trim());
            }
        });

        python.on('error', (err) => {
            console.error('Whisper spawn error:', err.message);
            resolve('[Transcription failed]');
        });

        setTimeout(() => {
            python.kill();
            resolve('[Transcription timed out]');
        }, 60000);
    });
}

async function processWithClaude(userRequest, isAuth) {
    try {
        const authContext = isAuth
            ? 'User IS authenticated - execution commands are ENABLED. If this requires action (updating sites, sending emails, etc.), include "NEEDS_EXECUTION" at the end of your response.'
            : 'User is NOT authenticated yet. For any execution requests, tell him the task is understood but he needs to say "forge ahead" first to enable execution.';

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            system: SYSTEM_PROMPT + `\n\n**Authentication Status:**\n${authContext}`,
            messages: [
                {
                    role: 'user',
                    content: `User just sent this request via WhatsApp voice/text:\n\n"${userRequest}"\n\nRespond appropriately. Keep it brief for WhatsApp.`
                }
            ]
        });

        return response.content[0].text;
    } catch (error) {
        console.error('Claude API error:', error.message);
        return '⚠️ Couldn\'t process that right now. Try again in a moment.';
    }
}

async function executeTask(userRequest) {
    // This will spawn Claude Code CLI to actually execute the task
    return new Promise((resolve) => {
        log(`⚡ Executing: "${userRequest}"`);

        // Use Claude Code CLI in non-interactive mode
        const claude = spawn('claude', [
            '--print',
            '--dangerously-skip-permissions',
            `Execute this task for User: ${userRequest}`
        ], {
            shell: true,
            timeout: 120000
        });

        let output = '';
        let errorOutput = '';

        claude.stdout.on('data', (data) => {
            output += data.toString();
        });

        claude.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        claude.on('close', (code) => {
            if (code === 0 && output.trim()) {
                // Summarize the output for WhatsApp (keep it short)
                const summary = output.length > 500
                    ? output.substring(0, 500) + '...\n\n[Full output truncated]'
                    : output;
                resolve(`✅ *Done*\n\n${summary}`);
            } else {
                log(`Execution error: ${errorOutput}`);
                resolve('⚠️ Task attempted but may have issues. Check manually.');
            }
        });

        claude.on('error', (err) => {
            log(`Spawn error: ${err.message}`);
            resolve('⚠️ Couldn\'t execute. Try again or do it manually.');
        });

        // Timeout after 2 minutes
        setTimeout(() => {
            claude.kill();
            resolve('⏱️ Task is taking too long. It may still be running in the background.');
        }, 120000);
    });
}

client.on('disconnected', (reason) => {
    log(`❌ Disconnected: ${reason}`);
});

process.on('SIGINT', () => {
    log('👋 Shutting down...');
    client.destroy();
    process.exit(0);
});

client.initialize();
