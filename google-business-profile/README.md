# Google Business Profile MCP Server

An MCP (Model Context Protocol) server for managing Google Business Profile (formerly Google My Business) listings through Claude and other AI assistants.

## Features

- **Account Management**: List accounts and locations
- **Location Updates**: Update business info, hours, description
- **Reviews**: List and reply to customer reviews
- **Posts**: Create, list, and delete business posts
- **Q&A**: Answer customer questions
- **Media**: List photos and videos
- **Insights**: Get performance metrics

## Setup

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google My Business API**:
   - Go to "APIs & Services" > "Library"
   - Search for "Google My Business API" or "Business Profile API"
   - Click "Enable"

### 2. Create OAuth Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. If prompted, configure the OAuth consent screen:
   - User Type: External (or Internal if using Workspace)
   - Add your email as a test user
4. Select "Desktop app" as the application type
5. Download the JSON file

### 3. Install and Configure

```bash
# Clone or navigate to the MCP server directory
cd ~/mcp-servers/google-business-profile

# Install dependencies
npm install

# Create config directory and add credentials
mkdir -p ~/.config/gbp-mcp
# Copy your downloaded credentials JSON to:
# ~/.config/gbp-mcp/credentials.json

# Run authentication
npm run auth
# This opens a browser to authenticate with Google
```

### 4. Add to Claude Code

Add to your Claude Code MCP settings (`~/.claude/mcp_servers.json` or via Claude Code settings):

```json
{
  "mcpServers": {
    "google-business-profile": {
      "command": "node",
      "args": ["C:/Users/Jakeb/mcp-servers/google-business-profile/dist/index.js"]
    }
  }
}
```

Or for development:

```json
{
  "mcpServers": {
    "google-business-profile": {
      "command": "npx",
      "args": ["tsx", "C:/Users/Jakeb/mcp-servers/google-business-profile/src/index.ts"]
    }
  }
}
```

### 5. Build for Production

```bash
npm run build
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_accounts` | List all GBP accounts you have access to |
| `list_locations` | List locations for an account |
| `get_location` | Get detailed location info |
| `update_location` | Update business info (hours, description, etc.) |
| `list_reviews` | List customer reviews |
| `reply_to_review` | Reply to a review |
| `delete_review_reply` | Delete your reply to a review |
| `create_post` | Create a new post (update, offer, event) |
| `list_posts` | List all posts |
| `delete_post` | Delete a post |
| `list_questions` | List Q&A |
| `answer_question` | Answer a customer question |
| `list_media` | List photos/videos |
| `get_insights` | Get performance metrics |

## Usage Examples

Once connected to Claude:

```
"List my Google Business Profile accounts"
"Show me all reviews for my business"
"Reply to the latest review with a thank you message"
"Create a post announcing our holiday hours"
"What are my business insights for the last 30 days?"
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GBP_CONFIG_DIR` | Config directory path | `~/.config/gbp-mcp` |

## Troubleshooting

### "API not enabled" error
Make sure you've enabled the Google My Business API in your Google Cloud project.

### "Permission denied" error
Ensure your Google account has admin access to the Business Profile you're trying to manage.

### Token expired
Run `npm run auth` again to refresh your authentication.

## License

MIT
