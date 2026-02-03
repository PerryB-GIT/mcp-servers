const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const path = require("path");

// Get home directory cross-platform
const homeDir = process.env.HOME || process.env.USERPROFILE;
const authPath = path.join(homeDir, "mcp-servers", "whatsapp", ".wwebjs_auth");

console.log("🔐 WhatsApp Authentication\n");
console.log("This will generate a QR code for you to scan with WhatsApp.\n");
console.log("Auth path:", authPath, "\n");

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: authPath,
  }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr) => {
  console.log("\n📱 Scan this QR code with WhatsApp:\n");
  console.log("   1. Open WhatsApp on your phone");
  console.log("   2. Tap Menu (⋮) or Settings");
  console.log("   3. Tap 'Linked Devices'");
  console.log("   4. Tap 'Link a Device'");
  console.log("   5. Point your phone at this QR code\n");
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("\n✅ Authenticated successfully!");
});

client.on("ready", async () => {
  console.log("🎉 WhatsApp is ready!");
  console.log("\nSession saved. WhatsApp client is now running.");
  console.log("You can send messages or press Ctrl+C to exit.\n");

  // Keep the client running indefinitely for message sending
  // The client will stay connected until you close it
  console.log("WhatsApp client is active and listening...\n");
});

client.on("auth_failure", (msg) => {
  console.error("❌ Authentication failed:", msg);
  process.exit(1);
});

console.log("Initializing WhatsApp connection...\n");
client.initialize();
