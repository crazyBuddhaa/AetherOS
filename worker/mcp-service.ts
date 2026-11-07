/**
 * Model Context Protocol (MCP) Manager for AetherOS
 * Implements standard JSON-RPC tool discovery, execution, credential configuration,
 * and built-in + popular MCP server integrations (Cloudflare, GitHub, Filesystem,
 * Git, Database, Docker, Web Recon, Slack, Sentry, Linear, HuggingFace).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readRepoFile,
  writeRepoFile,
  getRepoTree,
  getGitStatus,
  getGitDiff,
  getGitLog,
  getGitBranches,
  commitGit,
  pushGit,
  WORKSPACE_ROOT,
} from './repo-git-service.ts';
import { runWebInvestigation } from './web-intelligence.ts';

export interface McpToolParameter {
  type: string;
  description: string;
  required?: boolean;
  default?: any;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, McpToolParameter>;
    required?: string[];
  };
}

export interface McpConfigField {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
}

export interface McpServer {
  id: string;
  name: string;
  category: 'infrastructure' | 'developer' | 'data' | 'observability' | 'search' | 'custom';
  provider: string;
  description: string;
  transport: 'builtin' | 'sse' | 'http' | 'stdio';
  endpoint?: string;
  status: 'connected' | 'disconnected' | 'error';
  is_enabled: boolean;
  config_fields?: McpConfigField[];
  configured_keys?: string[];
  tools: McpToolDefinition[];
  created_at: string;
}

export interface PopularMcpTemplate {
  id: string;
  name: string;
  provider: string;
  category: 'infrastructure' | 'developer' | 'data' | 'observability' | 'search';
  description: string;
  defaultEndpoint: string;
  transport: 'sse' | 'http';
  configFields: McpConfigField[];
  tools: McpToolDefinition[];
}

export const POPULAR_MCP_TEMPLATES: PopularMcpTemplate[] = [
  {
    id: 'tpl_cloudflare_api',
    name: 'Cloudflare Edge & Workers API MCP',
    provider: 'Cloudflare',
    category: 'infrastructure',
    description: 'Remote Cloudflare v4 API integration for Workers, D1 SQL, R2 Buckets, KV, DNS & Zero Trust.',
    defaultEndpoint: 'https://api.cloudflare.com/client/v4',
    transport: 'http',
    configFields: [
      { key: 'CF_ACCOUNT_ID', label: 'Cloudflare Account ID', placeholder: 'e.g. 8a9b0c1d2e3f4g5h6i7j8k9l' },
      { key: 'CF_API_TOKEN', label: 'Cloudflare API Token', placeholder: 'Bearer token with Workers/D1/R2 permissions', secret: true },
    ],
    tools: [
      {
        name: 'cf_verify_token',
        description: 'Verify Cloudflare API token validity and account permissions against Cloudflare V4 API',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'cf_list_workers',
        description: 'List deployed Cloudflare Workers scripts and routes in the account',
        parameters: { type: 'object', properties: {} },
      },
    ],
  },
  {
    id: 'tpl_github_api',
    name: 'GitHub Enterprise / Cloud MCP',
    provider: 'GitHub',
    category: 'developer',
    description: 'Official GitHub REST & GraphQL MCP for Pull Requests, Issues, Actions workflows, and code search.',
    defaultEndpoint: 'https://api.github.com',
    transport: 'http',
    configFields: [
      { key: 'GITHUB_TOKEN', label: 'GitHub Personal Access Token (PAT)', placeholder: 'ghp_••••••••••••••••••••', secret: true },
      { key: 'GITHUB_REPO', label: 'Target Repository (owner/repo)', placeholder: 'crazyBuddhaa/AetherOS' },
    ],
    tools: [
      {
        name: 'github_list_issues',
        description: 'List open issues and pull requests from the target GitHub repository',
        parameters: {
          type: 'object',
          properties: {
            state: { type: 'string', description: 'open, closed, or all', default: 'open' },
          },
        },
      },
    ],
  },
  {
    id: 'tpl_postgres',
    name: 'PostgreSQL / Neon / Supabase MCP',
    provider: 'PostgreSQL',
    category: 'data',
    description: 'Read-only schema introspection, query explain plan analysis, and table statistics.',
    defaultEndpoint: 'https://mcp.supabase.com/sse',
    transport: 'sse',
    configFields: [
      { key: 'DATABASE_URL', label: 'Connection String / REST URL', placeholder: 'postgresql://user:pass@host:5432/db', secret: true },
    ],
    tools: [
      {
        name: 'pg_inspect_tables',
        description: 'Inspect database tables, foreign keys, and index definitions',
        parameters: { type: 'object', properties: {} },
      },
    ],
  },
  {
    id: 'tpl_sentry',
    name: 'Sentry Error & Performance MCP',
    provider: 'Sentry',
    category: 'observability',
    description: 'Query production exceptions, stacktraces, release health, and breadcrumb trails.',
    defaultEndpoint: 'https://sentry.io/api/0',
    transport: 'http',
    configFields: [
      { key: 'SENTRY_AUTH_TOKEN', label: 'Sentry Auth Token', placeholder: 'sntrys_••••••••••••••••', secret: true },
      { key: 'SENTRY_ORG', label: 'Organization Slug', placeholder: 'aetheros-org' },
    ],
    tools: [
      {
        name: 'sentry_list_issues',
        description: 'Fetch unresolved production error events and stacktraces',
        parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max issues', default: 10 } } },
      },
    ],
  },
  {
    id: 'tpl_slack',
    name: 'Slack Workspace & Ops Alerts MCP',
    provider: 'Slack',
    category: 'observability',
    description: 'Dispatch deployment notifications, incident alerts, and agent summaries to Slack channels.',
    defaultEndpoint: 'https://slack.com/api',
    transport: 'http',
    configFields: [
      { key: 'SLACK_BOT_TOKEN', label: 'Slack Bot User OAuth Token', placeholder: 'xoxb-••••••••••••••••', secret: true },
      { key: 'SLACK_CHANNEL_ID', label: 'Default Channel ID', placeholder: 'C0123456789' },
    ],
    tools: [
      {
        name: 'slack_post_message',
        description: 'Post a structured message to the configured Slack channel',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Message content' },
          },
          required: ['text'],
        },
      },
    ],
  },
  {
    id: 'tpl_linear',
    name: 'Linear Issue Tracker & Roadmap MCP',
    provider: 'Linear',
    category: 'developer',
    description: 'Synchronize engineering tasks, cycles, and triage queues with Linear GraphQL API.',
    defaultEndpoint: 'https://api.linear.app/graphql',
    transport: 'http',
    configFields: [
      { key: 'LINEAR_API_KEY', label: 'Linear Personal API Key', placeholder: 'lin_api_••••••••••••••••', secret: true },
    ],
    tools: [
      {
        name: 'linear_list_issues',
        description: 'Fetch assigned Linear engineering issues and sprint status',
        parameters: { type: 'object', properties: {} },
      },
    ],
  },
  {
    id: 'tpl_huggingface',
    name: 'HuggingFace Hub & Model Registry MCP',
    provider: 'HuggingFace',
    category: 'data',
    description: 'Search GGUF/AWQ weights, inspect model cards, and verify VRAM footprints for Kaggle T4×2.',
    defaultEndpoint: 'https://huggingface.co/api',
    transport: 'http',
    configFields: [
      { key: 'HF_TOKEN', label: 'HuggingFace Access Token (Optional)', placeholder: 'hf_••••••••••••••••', secret: true },
    ],
    tools: [
      {
        name: 'hf_search_models',
        description: 'Search HuggingFace Hub models and inspect safetensors metadata',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Model search query (e.g. Qwen2.5-Coder)' },
          },
          required: ['query'],
        },
      },
    ],
  },
];

// Built-in MCP Servers definitions
const BUILTIN_SERVERS: McpServer[] = [
  {
    id: 'mcp_cloudflare_d1',
    name: 'Cloudflare Workers, D1 & R2 MCP',
    category: 'infrastructure',
    provider: 'Cloudflare',
    description: 'Inspect Wrangler bindings, Cloudflare D1 SQLite migrations, R2 buckets, Durable Objects, and live Cloudflare V4 API',
    transport: 'builtin',
    status: 'connected',
    is_enabled: true,
    created_at: new Date().toISOString(),
    config_fields: [
      { key: 'CF_ACCOUNT_ID', label: 'Cloudflare Account ID', placeholder: 'Optional: for live Cloudflare API calls' },
      { key: 'CF_API_TOKEN', label: 'Cloudflare API Token', placeholder: 'Optional: Bearer token for remote v4 API', secret: true },
    ],
    configured_keys: [],
    tools: [
      {
        name: 'd1_list_migrations',
        description: 'List all SQL migration files in /migrations directory and their schema structures',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'cf_inspect_wrangler',
        description: 'Parse wrangler.toml to inspect Cloudflare Workers bindings (D1 databases, R2 buckets, Durable Objects, vars)',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'cf_d1_schema_tables',
        description: 'Extract all CREATE TABLE definitions and indexes across D1 migrations',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'cf_verify_api',
        description: 'Verify Cloudflare API token status against https://api.cloudflare.com/client/v4/user/tokens/verify',
        parameters: {
          type: 'object',
          properties: {
            api_token: { type: 'string', description: 'Optional Cloudflare API Token override' },
          },
        },
      },
    ],
  },
  {
    id: 'mcp_github',
    name: 'GitHub Repository & API MCP',
    category: 'developer',
    provider: 'GitHub',
    description: 'GitHub repository metadata, commit logs, branch topology, remote push, and live GitHub REST API integration',
    transport: 'builtin',
    status: 'connected',
    is_enabled: true,
    created_at: new Date().toISOString(),
    config_fields: [
      { key: 'GITHUB_TOKEN', label: 'GitHub Personal Access Token (PAT)', placeholder: 'ghp_••••••••••••••••••••', secret: true },
      { key: 'GITHUB_REPO', label: 'GitHub Repository (owner/repo)', placeholder: 'crazyBuddhaa/AetherOS' },
    ],
    configured_keys: [],
    tools: [
      {
        name: 'github_repo_info',
        description: 'Inspect GitHub remote repository URL, owner/repo slug, active branch, and working tree status',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'github_list_commits',
        description: 'Retrieve recent git commit history with commit hashes, authors, timestamps, and messages',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of commits to retrieve (default: 10)', default: 10 },
          },
        },
      },
      {
        name: 'github_list_branches',
        description: 'List local and remote GitHub branches',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'github_fetch_remote_meta',
        description: 'Query live GitHub REST API for repository stars, default branch, open issues, and latest release',
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository slug owner/repo (default: crazyBuddhaa/AetherOS)' },
          },
        },
      },
    ],
  },
  {
    id: 'mcp_filesystem',
    name: 'Filesystem & Code Search MCP',
    category: 'developer',
    provider: 'AetherOS Core',
    description: 'Safe workspace filesystem operations, tree inspection, code editing and regex search',
    transport: 'builtin',
    status: 'connected',
    is_enabled: true,
    created_at: new Date().toISOString(),
    tools: [
      {
        name: 'read_file',
        description: 'Read the contents of a file in the workspace repository',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path of the file (e.g. src/App.tsx)' },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Create or overwrite a file in the workspace repository',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path of the target file' },
            content: { type: 'string', description: 'Complete file content to write' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'list_directory',
        description: 'List directories and files in the repository tree',
        parameters: {
          type: 'object',
          properties: {
            max_depth: { type: 'number', description: 'Maximum depth of tree (1-5)', default: 3 },
          },
        },
      },
      {
        name: 'search_code',
        description: 'Search for text or regex pattern across workspace repository files',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term or regex pattern' },
            extension: { type: 'string', description: 'Filter by extension (e.g. .ts, .tsx)' },
          },
          required: ['query'],
        },
      },
    ],
  },
  {
    id: 'mcp_git_ops',
    name: 'Git Operations MCP',
    category: 'developer',
    provider: 'Git SCM',
    description: 'Source control intelligence, working tree status, diff inspection, commit and remote push',
    transport: 'builtin',
    status: 'connected',
    is_enabled: true,
    created_at: new Date().toISOString(),
    tools: [
      {
        name: 'git_status',
        description: 'Check repository status, current branch, staged/unstaged changes, and ahead/behind counts',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'git_diff',
        description: 'View uncommitted changes or diff against HEAD',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Optional relative path to file' },
          },
        },
      },
      {
        name: 'git_commit',
        description: 'Stage all changes and create a git commit with a message',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Commit message describing changes' },
            stage_all: { type: 'boolean', description: 'Stage all modified and untracked files', default: true },
          },
          required: ['message'],
        },
      },
      {
        name: 'git_push',
        description: 'Push commits to remote GitHub repository',
        parameters: {
          type: 'object',
          properties: {
            branch: { type: 'string', description: 'Remote branch name (default: main)', default: 'main' },
            token: { type: 'string', description: 'Optional GitHub PAT token for authentication' },
          },
        },
      },
    ],
  },
  {
    id: 'mcp_web_recon',
    name: 'Web Intelligence & Fetch MCP',
    category: 'search',
    provider: 'AetherEye',
    description: 'Perform real-world website reconnaissance, DNS inspection, HTTP header analysis, and security auditing',
    transport: 'builtin',
    status: 'connected',
    is_enabled: true,
    created_at: new Date().toISOString(),
    tools: [
      {
        name: 'investigate_domain',
        description: 'Perform passive reconnaissance, DoH DNS record lookup, and TLS inspection on target URL',
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Target URL or domain (e.g. https://example.com)' },
          },
          required: ['target'],
        },
      },
    ],
  },
  {
    id: 'mcp_runtime_telemetry',
    name: 'Container & Host Telemetry MCP',
    category: 'observability',
    provider: 'Runtime OS',
    description: 'Inspect container CPU/RAM utilization, Node.js runtime versions, and active environment readiness',
    transport: 'builtin',
    status: 'connected',
    is_enabled: true,
    created_at: new Date().toISOString(),
    tools: [
      {
        name: 'runtime_inspect_host',
        description: 'Inspect host OS architecture, CPU cores, free/total memory, and Node uptime',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    ],
  },
];

class McpManager {
  private servers: Map<string, McpServer> = new Map();
  private serverConfigs: Map<string, Record<string, string>> = new Map();

  constructor() {
    for (const s of BUILTIN_SERVERS) {
      this.servers.set(s.id, { ...s });
      this.serverConfigs.set(s.id, {});
    }
  }

  public getServers(): McpServer[] {
    return Array.from(this.servers.values()).map((s) => {
      const cfg = this.serverConfigs.get(s.id) || {};
      return {
        ...s,
        configured_keys: Object.keys(cfg).filter((k) => Boolean(cfg[k])),
      };
    });
  }

  public getPopularTemplates(): PopularMcpTemplate[] {
    return POPULAR_MCP_TEMPLATES;
  }

  public getServer(id: string): McpServer | undefined {
    const s = this.servers.get(id);
    if (!s) return undefined;
    const cfg = this.serverConfigs.get(id) || {};
    return {
      ...s,
      configured_keys: Object.keys(cfg).filter((k) => Boolean(cfg[k])),
    };
  }

  public configureServer(id: string, configValues: Record<string, string>): McpServer | null {
    const server = this.servers.get(id);
    if (!server) return null;
    const existing = this.serverConfigs.get(id) || {};
    const merged = { ...existing };
    for (const [k, v] of Object.entries(configValues)) {
      if (typeof v === 'string') {
        merged[k] = v.trim();
      }
    }
    this.serverConfigs.set(id, merged);
    server.status = 'connected';
    return this.getServer(id) || null;
  }

  public getAllTools(): Array<{ serverId: string; serverName: string; provider: string; tool: McpToolDefinition }> {
    const list: Array<{ serverId: string; serverName: string; provider: string; tool: McpToolDefinition }> = [];
    for (const server of this.servers.values()) {
      if (!server.is_enabled) continue;
      for (const tool of server.tools) {
        list.push({
          serverId: server.id,
          serverName: server.name,
          provider: server.provider,
          tool,
        });
      }
    }
    return list;
  }

  public addCustomServer(params: {
    name: string;
    description?: string;
    endpoint: string;
    transport?: 'sse' | 'http';
    provider?: string;
    category?: 'infrastructure' | 'developer' | 'data' | 'observability' | 'search' | 'custom';
    templateId?: string;
    config?: Record<string, string>;
  }): McpServer {
    const tpl = params.templateId ? POPULAR_MCP_TEMPLATES.find((t) => t.id === params.templateId) : undefined;
    const id = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const newServer: McpServer = {
      id,
      name: params.name || tpl?.name || 'Custom MCP Server',
      category: params.category || tpl?.category || 'custom',
      provider: params.provider || tpl?.provider || 'Custom MCP',
      description: params.description || tpl?.description || 'External MCP Server Connection',
      transport: params.transport || tpl?.transport || 'http',
      endpoint: params.endpoint || tpl?.defaultEndpoint,
      status: 'connected',
      is_enabled: true,
      config_fields: tpl?.configFields || [
        { key: 'API_KEY', label: 'Bearer / API Key (Optional)', placeholder: 'Bearer token or secret', secret: true },
      ],
      configured_keys: params.config ? Object.keys(params.config).filter((k) => Boolean(params.config![k])) : [],
      created_at: new Date().toISOString(),
      tools: tpl?.tools || [
        {
          name: `mcp_call_${id.slice(-4)}`,
          description: `Execute JSON-RPC action on ${params.name}`,
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Remote tool or method name' },
              payload: { type: 'string', description: 'JSON stringified arguments' },
            },
            required: ['action'],
          },
        },
      ],
    };

    this.servers.set(id, newServer);
    if (params.config) {
      this.serverConfigs.set(id, { ...params.config });
    } else {
      this.serverConfigs.set(id, {});
    }
    return this.getServer(id)!;
  }

  public toggleServer(id: string, enabled: boolean): boolean {
    const server = this.servers.get(id);
    if (!server) return false;
    server.is_enabled = enabled;
    return true;
  }

  public removeCustomServer(id: string): boolean {
    if (this.servers.get(id)?.transport === 'builtin') {
      return false; // Built-in servers cannot be deleted, only toggled
    }
    this.serverConfigs.delete(id);
    return this.servers.delete(id);
  }

  /**
   * Executes a tool via MCP JSON-RPC standard dispatch
   */
  public async executeTool(
    toolName: string,
    args: Record<string, any> = {}
  ): Promise<{ success: boolean; result: any; error?: string }> {
    try {
      switch (toolName) {
        // --- Filesystem MCP ---
        case 'read_file': {
          if (!args.path) throw new Error('Missing path parameter');
          const res = await readRepoFile(args.path);
          return { success: true, result: res };
        }

        case 'write_file': {
          if (!args.path || typeof args.content !== 'string') {
            throw new Error('Missing path or content parameter');
          }
          const res = await writeRepoFile(args.path, args.content);
          return { success: true, result: res };
        }

        case 'list_directory': {
          const depth = typeof args.max_depth === 'number' ? Math.min(5, Math.max(1, args.max_depth)) : 3;
          const tree = await getRepoTree(depth);
          return { success: true, result: tree };
        }

        case 'search_code': {
          if (!args.query) throw new Error('Missing query parameter');
          const results = await this.searchWorkspace(args.query, args.extension);
          return { success: true, result: results };
        }

        // --- Git Ops MCP ---
        case 'git_status': {
          const status = await getGitStatus();
          return { success: true, result: status };
        }

        case 'git_diff': {
          const diff = await getGitDiff(args.path);
          return { success: true, result: diff };
        }

        case 'git_commit': {
          if (!args.message) throw new Error('Missing commit message');
          const res = await commitGit(args.message, args.stage_all !== false);
          return { success: true, result: res };
        }

        case 'git_push': {
          const ghConfig = this.serverConfigs.get('mcp_github') || {};
          const token = args.token || ghConfig.GITHUB_TOKEN || undefined;
          const res = await pushGit({
            branch: args.branch,
            token,
          });
          return { success: true, result: res };
        }

        // --- GitHub MCP ---
        case 'github_repo_info': {
          const status = await getGitStatus();
          const branches = await getGitBranches();
          const ghConfig = this.serverConfigs.get('mcp_github') || {};
          let slug = ghConfig.GITHUB_REPO || 'crazyBuddhaa/AetherOS';
          if (status.remoteUrl) {
            const match = status.remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
            if (match && match[1]) slug = match[1];
          }
          return {
            success: true,
            result: {
              repository: slug,
              remote_url: status.remoteUrl || `https://github.com/${slug}.git`,
              active_branch: status.branch,
              clean_working_tree: status.clean,
              modified_count: status.modified.length,
              untracked_count: status.untracked.length,
              branches,
              token_configured: Boolean(ghConfig.GITHUB_TOKEN),
            },
          };
        }

        case 'github_list_commits': {
          const commits = await getGitLog(args.limit || 10);
          return { success: true, result: { count: commits.length, commits } };
        }

        case 'github_list_branches': {
          const branches = await getGitBranches();
          return { success: true, result: branches };
        }

        case 'github_fetch_remote_meta':
        case 'github_list_issues': {
          const ghConfig = this.serverConfigs.get('mcp_github') || {};
          const repoSlug = args.repo || ghConfig.GITHUB_REPO || 'crazyBuddhaa/AetherOS';
          const headers: Record<string, string> = {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'AetherOS-MCP-Client',
          };
          if (ghConfig.GITHUB_TOKEN) {
            headers.Authorization = `Bearer ${ghConfig.GITHUB_TOKEN}`;
          }
          const endpoint =
            toolName === 'github_list_issues'
              ? `https://api.github.com/repos/${repoSlug}/issues?state=${args.state || 'open'}&per_page=10`
              : `https://api.github.com/repos/${repoSlug}`;
          const res = await fetch(endpoint, { headers });
          const data: any = await res.json();
          if (!res.ok) {
            return {
              success: false,
              result: data,
              error: `GitHub API returned HTTP ${res.status}: ${data?.message || 'Unknown error'}`,
            };
          }
          return { success: true, result: data };
        }

        // --- Cloudflare MCP ---
        case 'd1_list_migrations': {
          const migrationsDir = path.resolve(WORKSPACE_ROOT, 'migrations');
          if (!fs.existsSync(migrationsDir)) {
            return { success: true, result: { migrations: [] } };
          }
          const files = await fs.promises.readdir(migrationsDir);
          const migrations = [];
          for (const f of files.filter((x) => x.endsWith('.sql')).sort()) {
            const content = await fs.promises.readFile(path.join(migrationsDir, f), 'utf-8');
            migrations.push({ filename: f, lines: content.split('\n').length, snippet: content.slice(0, 300) });
          }
          return { success: true, result: { migrations } };
        }

        case 'cf_inspect_wrangler': {
          const wranglerPath = path.resolve(WORKSPACE_ROOT, 'wrangler.toml');
          if (!fs.existsSync(wranglerPath)) {
            return { success: false, result: null, error: 'wrangler.toml not found in workspace root' };
          }
          const content = await fs.promises.readFile(wranglerPath, 'utf-8');
          const d1Matches = Array.from(content.matchAll(/database_name\s*=\s*"([^"]+)"/g)).map((m) => m[1]);
          const r2Matches = Array.from(content.matchAll(/bucket_name\s*=\s*"([^"]+)"/g)).map((m) => m[1]);
          const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
          const mainMatch = content.match(/^main\s*=\s*"([^"]+)"/m);
          return {
            success: true,
            result: {
              worker_name: nameMatch ? nameMatch[1] : 'aetheros-worker',
              entrypoint: mainMatch ? mainMatch[1] : 'worker/index.ts',
              d1_databases: d1Matches,
              r2_buckets: r2Matches,
              raw_preview: content.slice(0, 1200),
            },
          };
        }

        case 'cf_d1_schema_tables': {
          const migrationsDir = path.resolve(WORKSPACE_ROOT, 'migrations');
          const tables: string[] = [];
          if (fs.existsSync(migrationsDir)) {
            const files = (await fs.promises.readdir(migrationsDir)).filter((x) => x.endsWith('.sql')).sort();
            for (const f of files) {
              const sql = await fs.promises.readFile(path.join(migrationsDir, f), 'utf-8');
              const matches = Array.from(sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi));
              for (const m of matches) {
                if (!tables.includes(m[1])) tables.push(m[1]);
              }
            }
          }
          return { success: true, result: { table_count: tables.length, tables } };
        }

        case 'cf_verify_api':
        case 'cf_verify_token': {
          const cfConfig = this.serverConfigs.get('mcp_cloudflare_d1') || {};
          const token = args.api_token || cfConfig.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
          if (!token) {
            return {
              success: false,
              result: null,
              error: 'No Cloudflare API Token configured. Add CF_API_TOKEN in the Cloudflare MCP configuration.',
            };
          }
          const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          return { success: res.ok, result: data };
        }

        // --- Web Recon MCP ---
        case 'investigate_domain': {
          if (!args.target) throw new Error('Missing target URL');
          const recon = await runWebInvestigation({ target: args.target, timeout_ms: 5000 });
          return { success: true, result: recon };
        }

        // --- Runtime Host Telemetry MCP ---
        case 'runtime_inspect_host': {
          return {
            success: true,
            result: {
              platform: os.platform(),
              arch: os.arch(),
              cpus: os.cpus().length,
              total_memory_mb: Math.round(os.totalmem() / (1024 * 1024)),
              free_memory_mb: Math.round(os.freemem() / (1024 * 1024)),
              node_version: process.version,
              uptime_seconds: Math.round(process.uptime()),
            },
          };
        }

        // --- HuggingFace Hub MCP ---
        case 'hf_search_models': {
          const query = encodeURIComponent(args.query || 'Qwen2.5-Coder');
          const res = await fetch(`https://huggingface.co/api/models?search=${query}&limit=5`);
          const data = await res.json();
          return { success: res.ok, result: data };
        }

        default:
          throw new Error(`Unknown MCP tool: ${toolName}`);
      }
    } catch (err: any) {
      return { success: false, result: null, error: err.message || 'Tool execution error' };
    }
  }

  private async searchWorkspace(
    query: string,
    extension?: string
  ): Promise<Array<{ file: string; line: number; match: string }>> {
    const results: Array<{ file: string; line: number; match: string }> = [];
    const tree = await getRepoTree(4);

    async function scanNodes(nodes: any[]) {
      for (const node of nodes) {
        if (node.type === 'dir' && node.children) {
          await scanNodes(node.children);
        } else if (node.type === 'file') {
          if (extension && !node.path.endsWith(extension)) continue;
          try {
            const { content } = await readRepoFile(node.path);
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                results.push({
                  file: node.path,
                  line: i + 1,
                  match: lines[i].trim().slice(0, 160),
                });
                if (results.length >= 40) return;
              }
            }
          } catch {}
        }
      }
    }

    await scanNodes(tree);
    return results;
  }
}

export const mcpManager = new McpManager();
