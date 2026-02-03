#!/usr/bin/env node
/**
 * GitHub MCP Server
 * Wraps the gh CLI for repository, issue, PR, and branch management
 * Uses execFileSync for security (no shell injection)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Execute gh CLI command safely using execFileSync (no shell injection)
function gh(argsArray, options = {}) {
  try {
    const result = execFileSync('gh', argsArray, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      ...options
    });
    return { success: true, data: result.trim() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

const server = new Server(
  { name: 'github-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'github_repo_list',
      description: 'List repositories for the authenticated user or an organization',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Organization or user (optional, defaults to authenticated user)' },
          limit: { type: 'number', description: 'Max repos to return (default: 30)' }
        }
      }
    },
    {
      name: 'github_repo_view',
      description: 'Get details about a repository',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' }
        },
        required: ['repo']
      }
    },
    {
      name: 'github_repo_clone',
      description: 'Clone a repository',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          directory: { type: 'string', description: 'Local directory to clone into (optional)' }
        },
        required: ['repo']
      }
    },
    {
      name: 'github_issue_list',
      description: 'List issues in a repository',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state filter' },
          label: { type: 'string', description: 'Filter by label' },
          limit: { type: 'number', description: 'Max issues to return (default: 30)' }
        },
        required: ['repo']
      }
    },
    {
      name: 'github_issue_view',
      description: 'View a specific issue',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          number: { type: 'number', description: 'Issue number' }
        },
        required: ['repo', 'number']
      }
    },
    {
      name: 'github_issue_create',
      description: 'Create a new issue',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          title: { type: 'string', description: 'Issue title' },
          body: { type: 'string', description: 'Issue body/description' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Labels to add' },
          assignees: { type: 'array', items: { type: 'string' }, description: 'Users to assign' }
        },
        required: ['repo', 'title']
      }
    },
    {
      name: 'github_issue_close',
      description: 'Close an issue',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          number: { type: 'number', description: 'Issue number' },
          reason: { type: 'string', enum: ['completed', 'not_planned'], description: 'Close reason' }
        },
        required: ['repo', 'number']
      }
    },
    {
      name: 'github_issue_comment',
      description: 'Add a comment to an issue',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          number: { type: 'number', description: 'Issue number' },
          body: { type: 'string', description: 'Comment text' }
        },
        required: ['repo', 'number', 'body']
      }
    },
    {
      name: 'github_pr_list',
      description: 'List pull requests in a repository',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          state: { type: 'string', enum: ['open', 'closed', 'merged', 'all'], description: 'PR state filter' },
          base: { type: 'string', description: 'Filter by base branch' },
          limit: { type: 'number', description: 'Max PRs to return (default: 30)' }
        },
        required: ['repo']
      }
    },
    {
      name: 'github_pr_view',
      description: 'View a specific pull request',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          number: { type: 'number', description: 'PR number' }
        },
        required: ['repo', 'number']
      }
    },
    {
      name: 'github_pr_create',
      description: 'Create a new pull request',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          title: { type: 'string', description: 'PR title' },
          body: { type: 'string', description: 'PR description' },
          base: { type: 'string', description: 'Base branch (default: main)' },
          head: { type: 'string', description: 'Head branch to merge from' },
          draft: { type: 'boolean', description: 'Create as draft PR' }
        },
        required: ['repo', 'title', 'head']
      }
    },
    {
      name: 'github_pr_merge',
      description: 'Merge a pull request',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          number: { type: 'number', description: 'PR number' },
          method: { type: 'string', enum: ['merge', 'squash', 'rebase'], description: 'Merge method' },
          delete_branch: { type: 'boolean', description: 'Delete branch after merge' }
        },
        required: ['repo', 'number']
      }
    },
    {
      name: 'github_pr_review',
      description: 'Submit a review on a pull request',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          number: { type: 'number', description: 'PR number' },
          event: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'], description: 'Review action' },
          body: { type: 'string', description: 'Review comment' }
        },
        required: ['repo', 'number', 'event']
      }
    },
    {
      name: 'github_pr_comment',
      description: 'Add a comment to a pull request',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          number: { type: 'number', description: 'PR number' },
          body: { type: 'string', description: 'Comment text' }
        },
        required: ['repo', 'number', 'body']
      }
    },
    {
      name: 'github_branch_list',
      description: 'List branches in a repository',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' }
        },
        required: ['repo']
      }
    },
    {
      name: 'github_release_list',
      description: 'List releases in a repository',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          limit: { type: 'number', description: 'Max releases to return (default: 30)' }
        },
        required: ['repo']
      }
    },
    {
      name: 'github_release_create',
      description: 'Create a new release',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          tag: { type: 'string', description: 'Tag name for the release' },
          title: { type: 'string', description: 'Release title' },
          notes: { type: 'string', description: 'Release notes' },
          draft: { type: 'boolean', description: 'Create as draft' },
          prerelease: { type: 'boolean', description: 'Mark as prerelease' }
        },
        required: ['repo', 'tag']
      }
    },
    {
      name: 'github_gist_create',
      description: 'Create a new gist',
      inputSchema: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Filename for the gist' },
          content: { type: 'string', description: 'Content of the gist' },
          description: { type: 'string', description: 'Gist description' },
          public: { type: 'boolean', description: 'Make gist public (default: false)' }
        },
        required: ['filename', 'content']
      }
    },
    {
      name: 'github_gist_list',
      description: 'List your gists',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max gists to return (default: 30)' }
        }
      }
    },
    {
      name: 'github_workflow_list',
      description: 'List GitHub Actions workflows',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' }
        },
        required: ['repo']
      }
    },
    {
      name: 'github_workflow_run',
      description: 'Trigger a workflow run',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          workflow: { type: 'string', description: 'Workflow file name or ID' },
          ref: { type: 'string', description: 'Branch or tag to run on (default: main)' }
        },
        required: ['repo', 'workflow']
      }
    },
    {
      name: 'github_run_list',
      description: 'List recent workflow runs',
      inputSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository in owner/repo format' },
          workflow: { type: 'string', description: 'Filter by workflow name' },
          limit: { type: 'number', description: 'Max runs to return (default: 20)' }
        },
        required: ['repo']
      }
    },
    {
      name: 'github_search_repos',
      description: 'Search for repositories',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default: 30)' }
        },
        required: ['query']
      }
    },
    {
      name: 'github_search_issues',
      description: 'Search for issues and PRs',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default: 30)' }
        },
        required: ['query']
      }
    },
    {
      name: 'github_user_view',
      description: 'View user profile',
      inputSchema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'GitHub username (optional, defaults to authenticated user)' }
        }
      }
    },
    {
      name: 'github_notifications',
      description: 'List your notifications',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max notifications (default: 30)' }
        }
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'github_repo_list': {
        const ghArgs = ['repo', 'list'];
        if (args.owner) ghArgs.push('-o', args.owner);
        ghArgs.push('--limit', String(args.limit || 30));
        ghArgs.push('--json', 'name,description,url,isPrivate,updatedAt');
        result = gh(ghArgs);
        if (result.success) result.data = JSON.parse(result.data);
        break;
      }

      case 'github_repo_view': {
        result = gh(['repo', 'view', args.repo, '--json', 'name,description,url,homepageUrl,isPrivate,defaultBranchRef,stargazerCount,forkCount']);
        if (result.success) result.data = JSON.parse(result.data);
        break;
      }

      case 'github_repo_clone': {
        const ghArgs = ['repo', 'clone', args.repo];
        if (args.directory) ghArgs.push(args.directory);
        result = gh(ghArgs);
        break;
      }

      case 'github_issue_list': {
        const ghArgs = ['issue', 'list', '-R', args.repo];
        if (args.state) ghArgs.push('--state', args.state);
        if (args.label) ghArgs.push('--label', args.label);
        ghArgs.push('--limit', String(args.limit || 30));
        ghArgs.push('--json', 'number,title,state,author,labels,createdAt,url');
        result = gh(ghArgs);
        if (result.success) result.data = JSON.parse(result.data);
        break;
      }

      case 'github_issue_view': {
        result = gh(['issue', 'view', String(args.number), '-R', args.repo, '--json', 'number,title,body,state,author,labels,assignees,comments,createdAt,url']);
        if (result.success) result.data = JSON.parse(result.data);
        break;
      }

      case 'github_issue_create': {
        const ghArgs = ['issue', 'create', '-R', args.repo, '--title', args.title];
        if (args.body) ghArgs.push('--body', args.body);
        if (args.labels && args.labels.length) ghArgs.push('--label', args.labels.join(','));
        if (args.assignees && args.assignees.length) ghArgs.push('--assignee', args.assignees.join(','));
        result = gh(ghArgs);
        break;
      }

      case 'github_issue_close': {
        const ghArgs = ['issue', 'close', String(args.number), '-R', args.repo];
        if (args.reason) ghArgs.push('--reason', args.reason);
        result = gh(ghArgs);
        break;
      }

      case 'github_issue_comment': {
        result = gh(['issue', 'comment', String(args.number), '-R', args.repo, '--body', args.body]);
        break;
      }

      case 'github_pr_list': {
        const ghArgs = ['pr', 'list', '-R', args.repo];
        if (args.state) ghArgs.push('--state', args.state);
        if (args.base) ghArgs.push('--base', args.base);
        ghArgs.push('--limit', String(args.limit || 30));
        ghArgs.push('--json', 'number,title,state,author,baseRefName,headRefName,createdAt,url');
        result = gh(ghArgs);
        if (result.success) result.data = JSON.parse(result.data);
        break;
      }

      case 'github_pr_view': {
        result = gh(['pr', 'view', String(args.number), '-R', args.repo, '--json', 'number,title,body,state,author,baseRefName,headRefName,commits,files,comments,reviews,url']);
        if (result.success) result.data = JSON.parse(result.data);
        break;
      }

      case 'github_pr_create': {
        const ghArgs = ['pr', 'create', '-R', args.repo, '--title', args.title, '--head', args.head];
        if (args.base) ghArgs.push('--base', args.base);
        if (args.body) ghArgs.push('--body', args.body);
        if (args.draft) ghArgs.push('--draft');
        result = gh(ghArgs);
        break;
      }

      case 'github_pr_merge': {
        const ghArgs = ['pr', 'merge', String(args.number), '-R', args.repo];
        ghArgs.push(args.method === 'squash' ? '--squash' : args.method === 'rebase' ? '--rebase' : '--merge');
        if (args.delete_branch) ghArgs.push('--delete-branch');
        result = gh(ghArgs);
        break;
      }

      case 'github_pr_review': {
        const ghArgs = ['pr', 'review', String(args.number), '-R', args.repo];
        if (args.event === 'APPROVE') ghArgs.push('--approve');
        else if (args.event === 'REQUEST_CHANGES') ghArgs.push('--request-changes');
        else ghArgs.push('--comment');
        if (args.body) ghArgs.push('--body', args.body);
        result = gh(ghArgs);
        break;
      }

      case 'github_pr_comment': {
        result = gh(['pr', 'comment', String(args.number), '-R', args.repo, '--body', args.body]);
        break;
      }

      case 'github_branch_list': {
        result = gh(['api', `repos/${args.repo}/branches`, '--jq', '.[] | {name, protected}']);
        if (result.success) {
          const lines = result.data.split('\n').filter(Boolean);
          result.data = lines.map(l => JSON.parse(l));
        }
        break;
      }

      case 'github_release_list': {
        result = gh(['release', 'list', '-R', args.repo, '--limit', String(args.limit || 30)]);
        break;
      }

      case 'github_release_create': {
        const ghArgs = ['release', 'create', args.tag, '-R', args.repo];
        if (args.title) ghArgs.push('--title', args.title);
        if (args.notes) ghArgs.push('--notes', args.notes);
        else ghArgs.push('--generate-notes');
        if (args.draft) ghArgs.push('--draft');
        if (args.prerelease) ghArgs.push('--prerelease');
        result = gh(ghArgs);
        break;
      }

      case 'github_gist_create': {
        const tmpFile = join(tmpdir(), `gist_${Date.now()}_${args.filename}`);
        writeFileSync(tmpFile, args.content);
        const ghArgs = ['gist', 'create', tmpFile];
        if (args.description) ghArgs.push('--desc', args.description);
        if (args.public) ghArgs.push('--public');
        result = gh(ghArgs);
        unlinkSync(tmpFile);
        break;
      }

      case 'github_gist_list': {
        result = gh(['gist', 'list', '--limit', String(args.limit || 30)]);
        break;
      }

      case 'github_workflow_list': {
        result = gh(['workflow', 'list', '-R', args.repo]);
        break;
      }

      case 'github_workflow_run': {
        const ghArgs = ['workflow', 'run', args.workflow, '-R', args.repo];
        if (args.ref) ghArgs.push('--ref', args.ref);
        result = gh(ghArgs);
        if (result.success) result.data = `Workflow ${args.workflow} triggered`;
        break;
      }

      case 'github_run_list': {
        const ghArgs = ['run', 'list', '-R', args.repo];
        if (args.workflow) ghArgs.push('--workflow', args.workflow);
        ghArgs.push('--limit', String(args.limit || 20));
        ghArgs.push('--json', 'databaseId,displayTitle,status,conclusion,workflowName,createdAt,url');
        result = gh(ghArgs);
        if (result.success) result.data = JSON.parse(result.data);
        break;
      }

      case 'github_search_repos': {
        result = gh(['search', 'repos', args.query, '--limit', String(args.limit || 30), '--json', 'fullName,description,url,stargazersCount,updatedAt']);
        if (result.success) result.data = JSON.parse(result.data);
        break;
      }

      case 'github_search_issues': {
        result = gh(['search', 'issues', args.query, '--limit', String(args.limit || 30), '--json', 'number,title,repository,state,url,createdAt']);
        if (result.success) result.data = JSON.parse(result.data);
        break;
      }

      case 'github_user_view': {
        const endpoint = args.username ? `users/${args.username}` : 'user';
        result = gh(['api', endpoint]);
        if (result.success) result.data = JSON.parse(result.data);
        break;
      }

      case 'github_notifications': {
        result = gh(['api', 'notifications']);
        if (result.success) {
          result.data = JSON.parse(result.data).slice(0, args.limit || 30);
        }
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, error: error.message }, null, 2)
      }],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GitHub MCP server running on stdio');
}

main().catch(console.error);
