const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

console.log('');
console.log('╔═══════════════════════════════════════════╗');
console.log('║  Claude Receptionist - WhatsApp Auth      ║');
console.log('╚═══════════════════════════════════════════╝');
console.log('');
console.log('Scan the QR code with WhatsApp on your phone:');
console.log('  1. Open WhatsApp');
console.log('  2. Tap ⋮ (menu) > Linked Devices');
console.log('  3. Tap "Link a Device"');
console.log('  4. Scan the QR code below');
console.log('');

const path = require('path');

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.join(__dirname, '.wwebjs_receptionist_v3')
    }),
    puppeteer: {
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--user-data-dir=' + path.join(__dirname, '.wwebjs_receptionist_v3', 'chrome_profile')
        ]
    }
});

client.on('qr', (qr) => {
    console.log('');
    qrcode.generate(qr, { small: true });
    console.log('');
    console.log('Waiting for scan...');
});

client.on('ready', () => {
    console.log('');
    console.log('✅ SUCCESS! Receptionist authenticated.');
    console.log('');
    console.log('You can now run: npm run live');
    console.log('');
    client.destroy();
    process.exit(0);
});

client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
    process.exit(1);
});

client.initialize();
