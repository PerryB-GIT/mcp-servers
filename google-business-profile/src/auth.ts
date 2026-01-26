#!/usr/bin/env node
/**
 * OAuth setup script for Google Business Profile MCP
 * Run this once to authenticate: npx tsx src/auth.ts
 */

import { OAuth2Client } from "google-auth-library";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as url from "url";

const CONFIG_DIR = process.env.GBP_CONFIG_DIR || path.join(process.env.HOME || process.env.USERPROFILE || "", ".config", "gbp-mcp");
const CREDENTIALS_PATH = path.join(CONFIG_DIR, "credentials.json");
const TOKEN_PATH = path.join(CONFIG_DIR, "token.json");

const SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
];

async function authenticate() {
  // Ensure config directory exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    console.log(`Created config directory: ${CONFIG_DIR}`);
  }

  // Check for credentials
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`
ERROR: OAuth credentials not found!

Please follow these steps:
1. Go to https://console.cloud.google.com/
2. Create a new project or select existing
3. Enable "Google My Business API" (search in API Library)
4. Go to "Credentials" > "Create Credentials" > "OAuth client ID"
5. Select "Desktop app" as application type
6. Download the JSON file
7. Save it as: ${CREDENTIALS_PATH}

Then run this script again.
`);
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

  // Use localhost redirect for desktop auth
  const PORT = process.env.AUTH_PORT || 3001;
  const redirectUri = `http://localhost:${PORT}/oauth2callback`;
  const oauth2Client = new OAuth2Client(client_id, client_secret, redirectUri);

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("\n=== Google Business Profile MCP Authentication ===\n");
  console.log("1. Open this URL in your browser:\n");
  console.log(authUrl);
  console.log("\n2. Sign in with your Google account that manages the business");
  console.log("3. Grant the requested permissions\n");

  // Start local server to receive callback
  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith("/oauth2callback")) {
      const qs = new url.URL(req.url, `http://localhost:${PORT}`).searchParams;
      const code = qs.get("code");

      if (code) {
        try {
          const { tokens } = await oauth2Client.getToken(code);
          oauth2Client.setCredentials(tokens);

          // Save token
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; text-align: center; padding: 50px;">
                <h1>Authentication Successful!</h1>
                <p>You can close this window and return to the terminal.</p>
                <p>Token saved to: ${TOKEN_PATH}</p>
              </body>
            </html>
          `);

          console.log("\n✓ Authentication successful!");
          console.log(`✓ Token saved to: ${TOKEN_PATH}`);
          console.log("\nYou can now use the Google Business Profile MCP server.");

          setTimeout(() => {
            server.close();
            process.exit(0);
          }, 1000);
        } catch (error) {
          console.error("Error getting token:", error);
          res.writeHead(500);
          res.end("Authentication failed");
          process.exit(1);
        }
      } else {
        res.writeHead(400);
        res.end("No authorization code received");
      }
    }
  });

  server.listen(PORT, () => {
    console.log(`Waiting for authentication on port ${PORT}...\n`);
  });
}

authenticate().catch(console.error);
