# MCP Servers Collection

Custom Model Context Protocol (MCP) servers for Claude Code, built by Perry Bailes.

## Overview

These MCP servers extend Claude Code's capabilities with integrations for Google services, AWS, Stripe, and more.

## Available Servers

### Google Services (OAuth authenticated)

| Server | Description | Tools |
|--------|-------------|-------|
| `gmail` | Gmail integration | send_email, search_emails, read_email, draft_email, list_labels |
| `google-calendar` | Calendar management | create_event, list_events, update_event, delete_event |
| `google-drive` | Drive file operations | list_files, read_file, create_folder, share_file, search |
| `google-sheets` | Spreadsheet operations | read_range, write_range, append_rows, create_spreadsheet |
| `google-meet` | Meeting management | create_instant, schedule, list_upcoming |
| `google-tasks` | Task management | list_tasks, create_task, complete_task, update_task |
| `google-business-profile` | Business profile management | Profile updates and management |

### AWS & Cloud

| Server | Description | Tools |
|--------|-------------|-------|
| `cost-analyzer` | Multi-cloud cost monitoring | costs_get_summary, costs_check_alerts, costs_set_threshold |

### Financial

| Server | Description | Tools |
|--------|-------------|-------|
| `stripe` | Stripe payments integration | list_customers, create_invoice, send_invoice, list_payments |

### Gaming / D&D

| Server | Description | Tools |
|--------|-------------|-------|
| `dnd-5e-open5e` | D&D 5e rules from Open5e API | Spells, monsters, items, classes lookup |
| `dnd-dm-toolkit` | DM campaign tools | Dice rolling, initiative, campaign state |
| `dnd-knowledge-navigator` | D&D knowledge base | Search and verification tools |

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
      "args": ["C:/Users/YourName/mcp-servers/gmail/index.js"]
    },
    "google-calendar": {
      "command": "node",
      "args": ["C:/Users/YourName/mcp-servers/google-calendar/index.js"]
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

## License

Personal use. Built for Perry Bailes' Claude Code workflow.
