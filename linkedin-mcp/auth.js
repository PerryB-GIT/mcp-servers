/**
 * LinkedIn OAuth Authentication
 * Run with: npm run auth
 *
 * Requires environment variables:
 * - LINKEDIN_CLIENT_ID
 * - LINKEDIN_CLIENT_SECRET
 */

import express from 'express';
import open from 'open';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3335;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const TOKEN_PATH = join(__dirname, 'token.json');

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET environment variables required');
  console.error('Set them in your shell profile or run:');
  console.error('  export LINKEDIN_CLIENT_ID="your_client_id"');
  console.error('  export LINKEDIN_CLIENT_SECRET="your_client_secret"');
  process.exit(1);
}

// Scopes needed for posting
const SCOPES = [
  'openid',
  'profile',
  'email',
  'w_member_social'  // For posting
].join(' ');

const app = express();

app.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    res.send(`<h1>Error</h1><p>${error}</p>`);
    setTimeout(() => process.exit(1), 1000);
    return;
  }

  if (!code) {
    res.send('<h1>Error</h1><p>No authorization code received</p>');
    setTimeout(() => process.exit(1), 1000);
    return;
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      })
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      throw new Error(tokens.error_description || tokens.error);
    }

    // Save tokens
    writeFileSync(TOKEN_PATH, JSON.stringify({
      access_token: tokens.access_token,
      expires_in: tokens.expires_in,
      refresh_token: tokens.refresh_token,
      refresh_token_expires_in: tokens.refresh_token_expires_in,
      scope: tokens.scope,
      created_at: Date.now()
    }, null, 2));

    res.send(`
      <h1>LinkedIn Authentication Successful!</h1>
      <p>Access token saved to token.json</p>
      <p>Token expires in ${Math.round(tokens.expires_in / 86400)} days</p>
      <p>You can close this window.</p>
    `);

    console.log('Authentication successful! Token saved to token.json');
    setTimeout(() => process.exit(0), 2000);

  } catch (err) {
    res.send(`<h1>Error</h1><p>${err.message}</p>`);
    console.error('Token exchange failed:', err.message);
    setTimeout(() => process.exit(1), 1000);
  }
});

const server = app.listen(PORT, () => {
  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?` +
    `response_type=code&` +
    `client_id=${CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `scope=${encodeURIComponent(SCOPES)}`;

  console.log('Opening LinkedIn authorization page...');
  console.log(`If browser doesn't open, visit: ${authUrl}`);

  open(authUrl);
});
