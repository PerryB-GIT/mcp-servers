const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { Client, LocalAuth } = require("whatsapp-web.js");
const path = require("path");

let waClient = null;
let isReady = false;

// Get home directory cross-platform
const homeDir = process.env.HOME || process.env.USERPROFILE;
const authPath = path.join(homeDir, "mcp-servers", "whatsapp", ".wwebjs_auth");

// Initialize WhatsApp client
function initWhatsApp() {
  if (waClient) return;

  waClient = new Client({
    authStrategy: new LocalAuth({
      dataPath: authPath,
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  waClient.on("qr", (qr) => {
    console.error("WhatsApp QR Code - scan with your phone:");
    require("qrcode-terminal").generate(qr, { small: true });
  });

  waClient.on("ready", () => {
    isReady = true;
    console.error("WhatsApp client is ready!");
  });

  waClient.on("authenticated", () => {
    console.error("WhatsApp authenticated successfully");
  });

  waClient.on("auth_failure", (msg) => {
    console.error("WhatsApp authentication failed:", msg);
  });

  waClient.on("disconnected", (reason) => {
    isReady = false;
    console.error("WhatsApp disconnected:", reason);
  });

  waClient.initialize();
}

// MCP Server setup
const server = new Server(
  {
    name: "whatsapp-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "whatsapp_send",
        description: "Send a WhatsApp message to a contact or phone number",
        inputSchema: {
          type: "object",
          properties: {
            to: {
              type: "string",
              description: "Phone number with country code (e.g., 19785551234) or contact name",
            },
            message: {
              type: "string",
              description: "Message to send",
            },
          },
          required: ["to", "message"],
        },
      },
      {
        name: "whatsapp_get_chats",
        description: "Get list of recent WhatsApp chats",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of chats to return (default: 20)",
            },
          },
        },
      },
      {
        name: "whatsapp_get_messages",
        description: "Get messages from a specific chat",
        inputSchema: {
          type: "object",
          properties: {
            chatId: {
              type: "string",
              description: "Chat ID or phone number",
            },
            limit: {
              type: "number",
              description: "Maximum number of messages to return (default: 20)",
            },
          },
          required: ["chatId"],
        },
      },
      {
        name: "whatsapp_search_contacts",
        description: "Search for contacts by name",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Name to search for",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "whatsapp_search_messages",
        description: "Search messages across all chats",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Text to search for",
            },
            limit: {
              type: "number",
              description: "Maximum number of results (default: 20)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "whatsapp_status",
        description: "Check WhatsApp connection status",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!isReady && name !== "whatsapp_status") {
    return {
      content: [
        {
          type: "text",
          text: "WhatsApp is not connected. Run the auth script first: node ~/mcp-servers/whatsapp/auth.js",
        },
      ],
    };
  }

  try {
    switch (name) {
      case "whatsapp_status": {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                connected: isReady,
                message: isReady
                  ? "WhatsApp is connected and ready"
                  : "WhatsApp is not connected. Run auth.js to authenticate.",
              }),
            },
          ],
        };
      }

      case "whatsapp_send": {
        let chatId = args.to;

        // If it looks like a phone number, format it
        if (/^\d+$/.test(chatId.replace(/[^0-9]/g, ""))) {
          const number = chatId.replace(/[^0-9]/g, "");
          chatId = `${number}@c.us`;
        } else {
          // Search for contact by name
          const contacts = await waClient.getContacts();
          const contact = contacts.find(
            (c) => c.name?.toLowerCase().includes(chatId.toLowerCase()) ||
                   c.pushname?.toLowerCase().includes(chatId.toLowerCase())
          );
          if (contact) {
            chatId = contact.id._serialized;
          } else {
            return {
              content: [{ type: "text", text: `Contact "${args.to}" not found` }],
            };
          }
        }

        await waClient.sendMessage(chatId, args.message);
        return {
          content: [
            {
              type: "text",
              text: `Message sent to ${args.to}`,
            },
          ],
        };
      }

      case "whatsapp_get_chats": {
        const limit = args.limit || 20;
        const chats = await waClient.getChats();
        const chatList = chats.slice(0, limit).map((chat) => ({
          id: chat.id._serialized,
          name: chat.name,
          isGroup: chat.isGroup,
          unreadCount: chat.unreadCount,
          lastMessage: chat.lastMessage?.body?.substring(0, 100),
          timestamp: chat.lastMessage?.timestamp,
        }));

        return {
          content: [{ type: "text", text: JSON.stringify(chatList, null, 2) }],
        };
      }

      case "whatsapp_get_messages": {
        let chatId = args.chatId;
        const limit = args.limit || 20;

        // Format phone number if needed
        if (/^\d+$/.test(chatId.replace(/[^0-9]/g, ""))) {
          const number = chatId.replace(/[^0-9]/g, "");
          chatId = `${number}@c.us`;
        }

        const chat = await waClient.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit });

        const messageList = messages.map((msg) => ({
          id: msg.id._serialized,
          from: msg.from,
          fromMe: msg.fromMe,
          body: msg.body,
          timestamp: msg.timestamp,
          type: msg.type,
        }));

        return {
          content: [{ type: "text", text: JSON.stringify(messageList, null, 2) }],
        };
      }

      case "whatsapp_search_contacts": {
        const contacts = await waClient.getContacts();
        const query = args.query.toLowerCase();
        const matches = contacts
          .filter(
            (c) =>
              c.name?.toLowerCase().includes(query) ||
              c.pushname?.toLowerCase().includes(query) ||
              c.number?.includes(query)
          )
          .slice(0, 20)
          .map((c) => ({
            id: c.id._serialized,
            name: c.name || c.pushname,
            number: c.number,
            isMyContact: c.isMyContact,
          }));

        return {
          content: [{ type: "text", text: JSON.stringify(matches, null, 2) }],
        };
      }

      case "whatsapp_search_messages": {
        const query = args.query;
        const limit = args.limit || 20;
        const chats = await waClient.getChats();
        const results = [];

        for (const chat of chats.slice(0, 10)) {
          const messages = await chat.fetchMessages({ limit: 50 });
          for (const msg of messages) {
            if (msg.body?.toLowerCase().includes(query.toLowerCase())) {
              results.push({
                chatName: chat.name,
                chatId: chat.id._serialized,
                from: msg.from,
                fromMe: msg.fromMe,
                body: msg.body,
                timestamp: msg.timestamp,
              });
              if (results.length >= limit) break;
            }
          }
          if (results.length >= limit) break;
        }

        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
        };
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
    };
  }
});

// Start server
async function main() {
  initWhatsApp();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("WhatsApp MCP server running");
}

main().catch(console.error);
