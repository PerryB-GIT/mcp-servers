const { Client, LocalAuth } = require("whatsapp-web.js");
const path = require("path");

// Get arguments: node send.js <phone> <message>
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log("Usage: node send.js <phone_number> <message>");
  console.log("Example: node send.js {YOUR_PHONE} 'Hello from Claude!'");
  process.exit(1);
}

const phoneNumber = args[0].replace(/[^0-9]/g, "");
const message = args.slice(1).join(" ");

const homeDir = process.env.HOME || process.env.USERPROFILE;
const authPath = path.join(homeDir, "mcp-servers", "whatsapp", ".wwebjs_auth");

console.log(`Sending to: ${phoneNumber}`);
console.log(`Message: ${message}`);
console.log("Connecting...\n");

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: authPath }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", () => {
  console.log("❌ Session expired! Run 'node auth.js' first to authenticate.");
  process.exit(1);
});

client.on("ready", async () => {
  console.log("Connected!");
  try {
    const chatId = `${phoneNumber}@c.us`;
    await client.sendMessage(chatId, message);
    console.log(`✅ Message sent to ${phoneNumber}!`);
  } catch (err) {
    console.log("❌ Error sending:", err.message);
  }
  await client.destroy();
  process.exit(0);
});

client.on("auth_failure", (msg) => {
  console.log("❌ Auth failed:", msg);
  process.exit(1);
});

client.initialize();
