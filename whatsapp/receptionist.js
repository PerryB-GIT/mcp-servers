const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Config
const MY_NUMBER = '{YOUR_WHATSAPP_NUMBER}'; // Your Business - Your WhatsApp number
const TEMP_DIR = path.join(__dirname, 'temp');
const TASKS_FILE = path.join(__dirname, 'confirmed_tasks.json');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Load or initialize tasks
let confirmedTasks = [];
if (fs.existsSync(TASKS_FILE)) {
    confirmedTasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
}

// Pending confirmations (voice note ID -> transcription)
const pendingConfirmations = new Map();

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

console.log('🤖 Claude Receptionist starting...');

client.on('qr', (qr) => {
    console.log('QR Code needed - run: npm run auth');
});

client.on('ready', () => {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║   🤖 Claude Receptionist is READY!     ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log(`📱 WhatsApp: +1 {BUSINESS_PHONE} (Your Business)`);
    console.log('');
    console.log('📋 How to use:');
    console.log('   1. Send a voice note to yourself');
    console.log('   2. I\'ll transcribe and confirm');
    console.log('   3. Reply "yes" to save, "no" to discard');
    console.log('');
    console.log('💬 Commands: tasks | clear | help');
    console.log('');
    console.log('Listening for messages...');
    console.log('─'.repeat(45));
});

client.on('message', async (message) => {
    try {
        // Only process messages from yourself
        const fromMe = message.fromMe;
        const senderId = message.from;

        // Check if it's from your own number or sent by you
        if (!fromMe && !senderId.includes(MY_NUMBER)) {
            return;
        }

        // Handle voice notes
        if (message.hasMedia && (message.type === 'ptt' || message.type === 'audio')) {
            console.log(`\n🎤 Voice note received at ${new Date().toLocaleTimeString()}`);

            // Download the audio
            const media = await message.downloadMedia();
            const timestamp = Date.now();
            const audioPath = path.join(TEMP_DIR, `voice_${timestamp}.ogg`);
            const wavPath = path.join(TEMP_DIR, `voice_${timestamp}.wav`);

            // Save the audio file
            fs.writeFileSync(audioPath, Buffer.from(media.data, 'base64'));
            console.log(`💾 Saved audio file`);

            // Convert to WAV using ffmpeg
            console.log('🔄 Converting audio...');
            await new Promise((resolve, reject) => {
                execFile('ffmpeg', ['-i', audioPath, '-ar', '16000', '-ac', '1', wavPath, '-y'], (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });

            // Transcribe with Whisper (Python)
            console.log('🔄 Transcribing with Whisper...');
            const transcription = await transcribeWithWhisper(wavPath);
            console.log(`📝 "${transcription}"`);

            // Store pending confirmation
            pendingConfirmations.set(message.id._serialized, {
                transcription,
                timestamp: new Date().toISOString(),
                audioPath
            });

            // Send confirmation request
            const confirmMsg = `🎙️ *Voice Note Received*\n\n` +
                `I heard:\n"${transcription}"\n\n` +
                `Reply:\n` +
                `✅ *yes* - confirm and save\n` +
                `❌ *no* - discard`;

            await message.reply(confirmMsg);
            console.log('📤 Awaiting confirmation...');

            // Cleanup wav file
            if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
        }

        // Handle confirmation replies
        else if (message.body && pendingConfirmations.size > 0) {
            const reply = message.body.toLowerCase().trim();

            // Get the most recent pending confirmation
            const entries = [...pendingConfirmations.entries()];
            if (entries.length === 0) return;

            const [pendingId, pendingData] = entries[entries.length - 1];

            if (['yes', 'confirm', 'confirmed', 'approved', 'ok', 'okay', 'yep', 'yeah', 'y', '1', 'save'].includes(reply)) {
                // Save the confirmed task
                const task = {
                    id: Date.now(),
                    content: pendingData.transcription,
                    confirmedAt: new Date().toISOString(),
                    recordedAt: pendingData.timestamp,
                    status: 'pending'
                };

                confirmedTasks.push(task);
                fs.writeFileSync(TASKS_FILE, JSON.stringify(confirmedTasks, null, 2));

                pendingConfirmations.delete(pendingId);

                // Cleanup audio file
                if (pendingData.audioPath && fs.existsSync(pendingData.audioPath)) {
                    fs.unlinkSync(pendingData.audioPath);
                }

                const pendingCount = confirmedTasks.filter(t => t.status === 'pending').length;

                await message.reply(
                    `✅ *Task Saved*\n\n` +
                    `"${pendingData.transcription}"\n\n` +
                    `📋 ${pendingCount} task${pendingCount !== 1 ? 's' : ''} pending`
                );

                console.log(`✅ CONFIRMED: "${pendingData.transcription}"`);
            }
            else if (['no', 'cancel', 'cancelled', 'discard', 'delete', 'nope', 'n', 'redo', '0'].includes(reply)) {
                pendingConfirmations.delete(pendingId);

                // Cleanup audio file
                if (pendingData.audioPath && fs.existsSync(pendingData.audioPath)) {
                    fs.unlinkSync(pendingData.audioPath);
                }

                await message.reply(`❌ *Discarded*\n\nSend another voice note when ready.`);

                console.log(`❌ DISCARDED`);
            }
        }

        // Handle text commands
        else if (message.body) {
            const cmd = message.body.toLowerCase().trim();

            if (cmd === 'tasks' || cmd === 'list' || cmd === 'pending') {
                const pending = confirmedTasks.filter(t => t.status === 'pending');
                if (pending.length === 0) {
                    await message.reply('📋 No pending tasks.');
                } else {
                    let taskList = '📋 *Pending Tasks*\n\n';
                    pending.forEach((t, i) => {
                        const date = new Date(t.confirmedAt).toLocaleDateString();
                        taskList += `${i + 1}. ${t.content}\n   _${date}_\n\n`;
                    });
                    await message.reply(taskList);
                }
                console.log(`📋 Listed ${pending.length} tasks`);
            }
            else if (cmd === 'clear' || cmd === 'done' || cmd === 'complete') {
                const pendingCount = confirmedTasks.filter(t => t.status === 'pending').length;
                confirmedTasks = confirmedTasks.map(t => ({ ...t, status: 'completed' }));
                fs.writeFileSync(TASKS_FILE, JSON.stringify(confirmedTasks, null, 2));
                await message.reply(`✅ ${pendingCount} task${pendingCount !== 1 ? 's' : ''} marked complete.`);
                console.log(`✅ Cleared ${pendingCount} tasks`);
            }
            else if (cmd === 'help' || cmd === '?') {
                await message.reply(
                    `🤖 *Claude Receptionist*\n\n` +
                    `*Voice:* Send a voice note\n` +
                    `*Confirm:* yes / no\n\n` +
                    `*Commands:*\n` +
                    `• tasks - List pending\n` +
                    `• clear - Mark all done\n` +
                    `• help - This message`
                );
            }
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
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
                resolve('[Transcription failed - try again]');
            } else {
                resolve(output.trim());
            }
        });

        python.on('error', (err) => {
            console.error('Failed to start Whisper:', err.message);
            resolve('[Transcription failed - try again]');
        });

        // Timeout after 60 seconds
        setTimeout(() => {
            python.kill();
            resolve('[Transcription timed out]');
        }, 60000);
    });
}

client.on('disconnected', (reason) => {
    console.log('❌ Disconnected:', reason);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Receptionist shutting down...');
    client.destroy();
    process.exit(0);
});

client.initialize();
