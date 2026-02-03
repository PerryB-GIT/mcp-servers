/**
 * Canva OAuth Authentication
 * Run with: npm run auth
 *
 * Requires environment variables:
 * - CANVA_CLIENT_ID
 * - CANVA_CLIENT_SECRET
 */

import express from 'express';
import open from 'open';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3336;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const TOKEN_PATH = join(__dirname, 'token.json');

const CLIENT_ID = process.env.CANVA_CLIENT_ID;
const CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: CANVA_CLIENT_ID and CANVA_CLIENT_SECRET environment variables required');
  console.error('Get these from https://www.canva.com/developers/');
  process.exit(1);
}

// Scopes for Canva API
const SCOPES = [
  'design:content:read',
  'design:content:write',
  'design:meta:read',
  'asset:read',
  'asset:write',
  'folder:read',
  'folder:write',
  'profile:read'
].join(' ');

// Generate PKCE code verifier and challenge
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

const pkce = generatePKCE();
const state = crypto.randomBytes(16).toString('hex');

const app = express();

app.get('/callback', async (req, res) => {
  const { code, error, state: returnedState } = req.query;

  if (error) {
    res.send(`<h1>Error</h1><p>${error}</p>`);
    setTimeout(() => process.exit(1), 1000);
    return;
  }

  if (returnedState !== state) {
    res.send('<h1>Error</h1><p>State mismatch - possible CSRF attack</p>');
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
    const tokenResponse = await fetch('https://api.canva.com/rest/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code_verifier: pkce.verifier
      })
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      throw new Error(tokens.error_description || tokens.error);
    }

    // Save tokens
    writeFileSync(TOKEN_PATH, JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type,
      scope: tokens.scope,
      created_at: Date.now()
    }, null, 2));

    res.send(`
      <h1>Canva Authentication Successful!</h1>
      <p>Access token saved to token.json</p>
      <p>Token expires in ${Math.round(tokens.expires_in / 3600)} hours</p>
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
  const authUrl = `https://www.canva.com/api/oauth/authorize?` +
    `response_type=code&` +
    `client_id=${CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `scope=${encodeURIComponent(SCOPES)}&` +
    `code_challenge=${pkce.challenge}&` +
    `code_challenge_method=S256&` +
    `state=${state}`;

  console.log('Opening Canva authorization page...');
  console.log(`If browser doesn't open, visit: ${authUrl}`);

  open(authUrl);
});
