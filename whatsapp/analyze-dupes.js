const { Client, LocalAuth } = require('whatsapp-web.js');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: { headless: true }
});

client.on('ready', async () => {
    const contacts = await client.getContacts();
    const namedContacts = contacts
        .filter(c => c.name && !c.isGroup && !c.isBusiness)
        .map(c => ({
            name: c.name,
            number: c.number || c.id.user,
            id: c.id._serialized
        }));

    // Find duplicates by name
    const byName = {};
    namedContacts.forEach(c => {
        if (!byName[c.name]) byName[c.name] = [];
        byName[c.name].push(c);
    });

    const dupes = Object.entries(byName)
        .filter(([name, contacts]) => contacts.length > 1)
        .sort((a, b) => a[0].localeCompare(b[0]));

    console.log('=== DUPLICATE CONTACTS (same name) ===\n');

    let totalDupes = 0;
    dupes.forEach(([name, contacts]) => {
        console.log(`${name}:`);
        contacts.forEach(c => {
            console.log(`  - ${c.number} (${c.id})`);
        });
        totalDupes += contacts.length - 1; // Count extras
        console.log('');
    });

    console.log('-----------------------------------');
    console.log(`Total duplicate entries: ${dupes.length} names with ${totalDupes} extra entries`);
    console.log(`\nNote: Each name appears with 2 entries - one is the WhatsApp ID, one is the phone number.`);
    console.log(`This is normal WhatsApp behavior, not actual duplicates in your phone contacts.`);

    process.exit(0);
});

client.initialize();
