# MCP Servers Collection

Custom Model Context Protocol (MCP) servers for Claude Code.

## Overview

These MCP servers extend Claude Code's capabilities with integrations for Google services, AWS, social platforms, design tools, and more.

## Available Servers

### Google Services (OAuth authenticated)

| Server | Description | Tools |
|--------|-------------|-------|
| `gmail` | Gmail integration | send_email, search_emails, read_email, draft_email, list_labels, modify_labels |
| `google-calendar` | Calendar management | create_event, list_events, update_event, delete_event, list_calendars |
| `google-drive` | Drive file operations | list_files, read_file, create_folder, share_file, search, move_file |
| `google-sheets` | Spreadsheet operations | read_range, write_range, append_rows, create_spreadsheet, add_sheet |
| `google-meet` | Meeting management | create_instant, schedule, list_upcoming |
| `google-tasks` | Task management | list_tasks, create_task, complete_task, update_task, list_tasklists |
| `google-business-profile` | Business profile management | Profile updates and management |

### Social & Communication

| Server | Description | Tools |
|--------|-------------|-------|
| `linkedin-mcp` | LinkedIn posting | create_post, create_company_post, get_profile, get_company |
| `whatsapp` | WhatsApp messaging | send, get_chats, get_messages, search_contacts, search_messages |

### Design & Media

| Server | Description | Tools |
|--------|-------------|-------|
| `canva-mcp` | Canva design API | list_designs, create_design, export_design, upload_asset |
| `figma-mcp` | Figma design files | get_file, get_images, post_comment, get_components, get_styles |
| `heygen-mcp` | AI video generation | list_avatars, list_voices, create_video, translate_video |

### Developer Tools

| Server | Description | Tools |
|--------|-------------|-------|
| `github-mcp` | GitHub CLI wrapper | repo_list, issue_create, pr_create, pr_merge, workflow_run, search |
| `bigquery-mcp` | GCP BigQuery | query, insert_rows, create_table, export_table, list_datasets |

### Monitoring & Operations

| Server | Description | Tools |
|--------|-------------|-------|
| `cost-analyzer` | Multi-cloud cost monitoring | costs_get_summary, costs_check_alerts, costs_set_threshold, costs_throttle_check |
| `uptime-monitor` | Site uptime monitoring | Continuous monitoring with alerts, DR plan integration |

### Financial

| Server | Description | Tools |
|--------|-------------|-------|
| `stripe` | Stripe payments integration | list_customers, create_invoice, send_invoice, list_payments, create_payment_link |

## Setup

### Google Services Setup

1. Create a Google Cloud Project at https://console.cloud.google.com/
2. Enable the relevant APIs (Gmail API, Calendar API, etc.)
3. Create OAuth 2.0 credentials (Desktop app type)
4. Download credentials and save as `credentials.json` in each server directory
5. Run authentication:
   ```bash
   cd <server-directory>
   npm install
   npm run auth
   ```
6. Follow the OAuth flow in your browser

### LinkedIn MCP Setup

1. Create a LinkedIn Developer App at https://developer.linkedin.com/
2. Set environment variables:
   ```bash
   export LINKEDIN_CLIENT_ID="your-client-id"
   export LINKEDIN_CLIENT_SECRET="your-client-secret"
   ```
3. Run `npm run auth` to complete OAuth flow

### Canva MCP Setup

1. Create a Canva Developer App at https://www.canva.com/developers/
2. Set environment variables and run auth

### Figma & HeyGen Setup

These use API keys instead of OAuth:
```bash
export FIGMA_ACCESS_TOKEN="your-token"
export HEYGEN_API_KEY="your-key"
```

### WhatsApp Setup

Uses whatsapp-web.js for browser-based authentication:
```bash
cd whatsapp
npm install
npm run auth  # Scan QR code with WhatsApp mobile app
```

### Cost Analyzer Setup

1. Copy `config.example.json` to `config.json`
2. Update with your AWS profile names and GCP project ID
3. Ensure AWS CLI is configured with appropriate profiles
4. Ensure gcloud CLI is authenticated

### Stripe Setup

1. Add your Stripe API key to environment or config
2. Test with Stripe test mode first

## Configuration

Each server that requires credentials has an example config file:
- `credentials.example.json` - OAuth credential structure
- `config.example.json` - Configuration template

Copy these to their non-example versions and fill in your values.

**Never commit actual credentials to git!**

## Claude Code Integration

Add to your `~/.claude.json` MCP settings:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "node",
      "args": ["~/mcp-servers/gmail/index.js"]
    },
    "google-calendar": {
      "command": "node",
      "args": ["~/mcp-servers/google-calendar/index.js"]
    },
    "linkedin": {
      "command": "node",
      "args": ["~/mcp-servers/linkedin-mcp/index.js"]
    }
  }
}
```

## Re-authentication

If tokens expire:
```bash
cd ~/mcp-servers/<service>
npm run auth
```

## Security Notes

- All credential files are gitignored
- OAuth tokens expire and need periodic refresh
- Never share credentials.json or token.json files
- Use test/sandbox modes for payment integrations
- WhatsApp session data is stored locally and gitignored

## License

MIT License
