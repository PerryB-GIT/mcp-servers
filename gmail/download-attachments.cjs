const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const credentials = JSON.parse(fs.readFileSync('credentials.json'));
const token = JSON.parse(fs.readFileSync('token.json'));

const { client_id, client_secret } = credentials.installed || credentials.web;
const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
oauth2Client.setCredentials(token);

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

const outputDir = 'C:/Users/Jakeb/ameripro-painting/public';

async function main() {
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'has:attachment newer_than:1d from:perry.bailes@gmail.com',
    maxResults: 1
  });

  if (!res.data.messages) {
    console.log('No messages found');
    return;
  }

  const msg = res.data.messages[0];
  const full = await gmail.users.messages.get({
    userId: 'me',
    id: msg.id
  });

  const parts = full.data.payload.parts || [];

  for (const part of parts) {
    if (part.filename && part.body.attachmentId) {
      console.log('Downloading:', part.filename);

      const attachment = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: msg.id,
        id: part.body.attachmentId
      });

      const data = Buffer.from(attachment.data.data, 'base64');
      const filePath = path.join(outputDir, part.filename);
      fs.writeFileSync(filePath, data);
      console.log('Saved to:', filePath);
    }
  }

  console.log('\nDone! Files saved to:', outputDir);
}

main().catch(console.error);
