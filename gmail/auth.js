import { google } from 'googleapis';
import { createServer } from 'http';
import { URL } from 'url';
import { readFileSync, writeFileSync } from 'fs';
import open from 'open';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels'
];
const CREDENTIALS_PATH = new URL('./credentials.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TOKEN_PATH = new URL('./token.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

async function authenticate() {
  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    'http://localhost:3334/oauth2callback'
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });

  console.log('\n🔐 Gmail Authentication\n');
  console.log('Opening browser for authentication...\n');

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost:3334');
      if (url.pathname === '/oauth2callback') {
        const code = url.searchParams.get('code');
        if (code) {
          const { tokens } = await oAuth2Client.getToken(code);
          oAuth2Client.setCredentials(tokens);

          writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #fff;">
                <div style="text-align: center;">
                  <h1 style="color: #6366f1;">✅ Gmail Authentication Successful!</h1>
                  <p>You can close this window and return to Claude Code.</p>
                </div>
              </body>
            </html>
          `);

          console.log('✅ Token saved to token.json');
          console.log('🎉 Gmail authentication complete!\n');

          setTimeout(() => {
            server.close();
            process.exit(0);
          }, 1000);
        }
      }
    } catch (error) {
      console.error('Error during authentication:', error);
      res.writeHead(500);
      res.end('Authentication failed');
    }
  });

  server.listen(3334, () => {
    console.log('Waiting for authentication...\n');
    open(authUrl);
  });
}

authenticate().catch(console.error);
