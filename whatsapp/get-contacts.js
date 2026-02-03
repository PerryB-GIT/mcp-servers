const { Client, LocalAuth } = require('whatsapp-web.js');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: { headless: true }
});

client.on('ready', async () => {
    const contacts = await client.getContacts();
    const namedContacts = contacts
        .filter(c => c.name && !c.isGroup && !c.isBusiness)
        .map(c => ({ name: c.name, number: c.number || c.id.user }))
        .sort((a, b) => a.name.localeCompare(b.name));

    console.log('=== WhatsApp Contacts ===\n');
    namedContacts.forEach(c => console.log(`${c.name}: ${c.number}`));
    console.log('\nTotal:', namedContacts.length, 'contacts');
    process.exit(0);
});

client.on('auth_failure', () => {
    console.log('Auth failed - need to re-scan QR');
    process.exit(1);
});

client.initialize();
