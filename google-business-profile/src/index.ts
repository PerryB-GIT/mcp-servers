#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import * as fs from "fs";
import * as path from "path";

// Configuration paths
const CONFIG_DIR = process.env.GBP_CONFIG_DIR || path.join(process.env.HOME || process.env.USERPROFILE || "", ".config", "gbp-mcp");
const CREDENTIALS_PATH = path.join(CONFIG_DIR, "credentials.json");
const TOKEN_PATH = path.join(CONFIG_DIR, "token.json");

// OAuth scopes required
const SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
];

// Google Business Profile API base
const API_BASE = "https://mybusiness.googleapis.com/v4";
const API_V1_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";

class GoogleBusinessProfileMCP {
  private server: Server;
  private oauth2Client: OAuth2Client | null = null;

  constructor() {
    this.server = new Server(
      {
        name: "google-business-profile-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private async getAuthClient(): Promise<OAuth2Client> {
    if (this.oauth2Client) {
      return this.oauth2Client;
    }

    if (!fs.existsSync(CREDENTIALS_PATH)) {
      throw new Error(
        `Credentials not found at ${CREDENTIALS_PATH}. Please download OAuth credentials from Google Cloud Console.`
      );
    }

    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
    const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

    this.oauth2Client = new OAuth2Client(client_id, client_secret, redirect_uris[0]);

    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
      this.oauth2Client.setCredentials(token);
    } else {
      throw new Error(
        `Token not found at ${TOKEN_PATH}. Run the auth setup first: npx tsx src/auth.ts`
      );
    }

    return this.oauth2Client;
  }

  private async apiRequest(endpoint: string, method: string = "GET", body?: any): Promise<any> {
    const auth = await this.getAuthClient();
    const accessToken = (await auth.getAccessToken()).token;

    const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error (${response.status}): ${error}`);
    }

    return response.json();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "list_accounts",
          description: "List all Google Business Profile accounts you have access to",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
        {
          name: "list_locations",
          description: "List all locations for a specific account",
          inputSchema: {
            type: "object",
            properties: {
              accountId: {
                type: "string",
                description: "The account ID (e.g., 'accounts/123456789')",
              },
            },
            required: ["accountId"],
          },
        },
        {
          name: "get_location",
          description: "Get detailed information about a specific location",
          inputSchema: {
            type: "object",
            properties: {
              locationName: {
                type: "string",
                description: "Full location name (e.g., 'accounts/123/locations/456')",
              },
            },
            required: ["locationName"],
          },
        },
        {
          name: "update_location",
          description: "Update location information (hours, description, etc.)",
          inputSchema: {
            type: "object",
            properties: {
              locationName: {
                type: "string",
                description: "Full location name",
              },
              updateMask: {
                type: "string",
                description: "Comma-separated fields to update (e.g., 'regularHours,profile.description')",
              },
              locationData: {
                type: "object",
                description: "Location data to update",
              },
            },
            required: ["locationName", "updateMask", "locationData"],
          },
        },
        {
          name: "list_reviews",
          description: "List all reviews for a location",
          inputSchema: {
            type: "object",
            properties: {
              locationName: {
                type: "string",
                description: "Full location name",
              },
              pageSize: {
                type: "number",
                description: "Number of reviews to return (max 50)",
              },
            },
            required: ["locationName"],
          },
        },
        {
          name: "reply_to_review",
          description: "Reply to a customer review",
          inputSchema: {
            type: "object",
            properties: {
              reviewName: {
                type: "string",
                description: "Full review name (e.g., 'accounts/123/locations/456/reviews/789')",
              },
              comment: {
                type: "string",
                description: "Your reply to the review",
              },
            },
            required: ["reviewName", "comment"],
          },
        },
        {
          name: "delete_review_reply",
          description: "Delete your reply to a review",
          inputSchema: {
            type: "object",
            properties: {
              reviewName: {
                type: "string",
                description: "Full review name",
              },
            },
            required: ["reviewName"],
          },
        },
        {
          name: "create_post",
          description: "Create a new post (update, offer, or event)",
          inputSchema: {
            type: "object",
            properties: {
              locationName: {
                type: "string",
                description: "Full location name",
              },
              summary: {
                type: "string",
                description: "Post content (1500 chars max)",
              },
              topicType: {
                type: "string",
                enum: ["STANDARD", "EVENT", "OFFER"],
                description: "Type of post",
              },
              callToAction: {
                type: "object",
                description: "Optional CTA with actionType and url",
                properties: {
                  actionType: {
                    type: "string",
                    enum: ["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"],
                  },
                  url: { type: "string" },
                },
              },
            },
            required: ["locationName", "summary"],
          },
        },
        {
          name: "list_posts",
          description: "List all posts for a location",
          inputSchema: {
            type: "object",
            properties: {
              locationName: {
                type: "string",
                description: "Full location name",
              },
              pageSize: {
                type: "number",
                description: "Number of posts to return",
              },
            },
            required: ["locationName"],
          },
        },
        {
          name: "delete_post",
          description: "Delete a post",
          inputSchema: {
            type: "object",
            properties: {
              postName: {
                type: "string",
                description: "Full post name (e.g., 'accounts/123/locations/456/localPosts/789')",
              },
            },
            required: ["postName"],
          },
        },
        {
          name: "list_questions",
          description: "List Q&A for a location",
          inputSchema: {
            type: "object",
            properties: {
              locationName: {
                type: "string",
                description: "Full location name",
              },
            },
            required: ["locationName"],
          },
        },
        {
          name: "answer_question",
          description: "Answer a question on your listing",
          inputSchema: {
            type: "object",
            properties: {
              questionName: {
                type: "string",
                description: "Full question name",
              },
              answer: {
                type: "string",
                description: "Your answer to the question",
              },
            },
            required: ["questionName", "answer"],
          },
        },
        {
          name: "list_media",
          description: "List media (photos/videos) for a location",
          inputSchema: {
            type: "object",
            properties: {
              locationName: {
                type: "string",
                description: "Full location name",
              },
            },
            required: ["locationName"],
          },
        },
        {
          name: "get_insights",
          description: "Get performance insights for a location",
          inputSchema: {
            type: "object",
            properties: {
              locationName: {
                type: "string",
                description: "Full location name",
              },
              startDate: {
                type: "string",
                description: "Start date (YYYY-MM-DD)",
              },
              endDate: {
                type: "string",
                description: "End date (YYYY-MM-DD)",
              },
            },
            required: ["locationName"],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "list_accounts": {
            const result = await this.apiRequest("/accounts");
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          case "list_locations": {
            const { accountId } = args as { accountId: string };
            const result = await this.apiRequest(`/${accountId}/locations`);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          case "get_location": {
            const { locationName } = args as { locationName: string };
            const result = await this.apiRequest(`/${locationName}`);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          case "update_location": {
            const { locationName, updateMask, locationData } = args as {
              locationName: string;
              updateMask: string;
              locationData: any;
            };
            const result = await this.apiRequest(
              `/${locationName}?updateMask=${updateMask}`,
              "PATCH",
              locationData
            );
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          case "list_reviews": {
            const { locationName, pageSize = 50 } = args as { locationName: string; pageSize?: number };
            const result = await this.apiRequest(`/${locationName}/reviews?pageSize=${pageSize}`);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          case "reply_to_review": {
            const { reviewName, comment } = args as { reviewName: string; comment: string };
            const result = await this.apiRequest(`/${reviewName}/reply`, "PUT", { comment });
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          case "delete_review_reply": {
            const { reviewName } = args as { reviewName: string };
            await this.apiRequest(`/${reviewName}/reply`, "DELETE");
            return { content: [{ type: "text", text: "Reply deleted successfully" }] };
          }

          case "create_post": {
            const { locationName, summary, topicType = "STANDARD", callToAction } = args as {
              locationName: string;
              summary: string;
              topicType?: string;
              callToAction?: { actionType: string; url: string };
            };
            const postData: any = {
              summary,
              topicType,
              languageCode: "en",
            };
            if (callToAction) {
              postData.callToAction = callToAction;
            }
            const result = await this.apiRequest(`/${locationName}/localPosts`, "POST", postData);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          case "list_posts": {
            const { locationName, pageSize = 20 } = args as { locationName: string; pageSize?: number };
            const result = await this.apiRequest(`/${locationName}/localPosts?pageSize=${pageSize}`);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          case "delete_post": {
            const { postName } = args as { postName: string };
            await this.apiRequest(`/${postName}`, "DELETE");
            return { content: [{ type: "text", text: "Post deleted successfully" }] };
          }

          case "list_questions": {
            const { locationName } = args as { locationName: string };
            const result = await this.apiRequest(`/${locationName}/questions`);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          case "answer_question": {
            const { questionName, answer } = args as { questionName: string; answer: string };
            const result = await this.apiRequest(`/${questionName}/answers:upsert`, "POST", {
              answer: { text: answer },
            });
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          case "list_media": {
            const { locationName } = args as { locationName: string };
            const result = await this.apiRequest(`/${locationName}/media`);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          case "get_insights": {
            const { locationName, startDate, endDate } = args as {
              locationName: string;
              startDate?: string;
              endDate?: string;
            };
            // Default to last 30 days
            const end = endDate || new Date().toISOString().split("T")[0];
            const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

            const result = await this.apiRequest(
              `/${locationName}:getDailyMetricsTimeSeries?dailyRange.startDate.year=${start.split("-")[0]}&dailyRange.startDate.month=${parseInt(start.split("-")[1])}&dailyRange.startDate.day=${parseInt(start.split("-")[2])}&dailyRange.endDate.year=${end.split("-")[0]}&dailyRange.endDate.month=${parseInt(end.split("-")[1])}&dailyRange.endDate.day=${parseInt(end.split("-")[2])}`
            );
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Google Business Profile MCP server running on stdio");
  }
}

const server = new GoogleBusinessProfileMCP();
server.run().catch(console.error);
