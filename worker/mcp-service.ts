/**
 * Model Context Protocol (MCP) Manager for AetherOS
 * Implements standard JSON-RPC tool discovery, execution, and external MCP server bridging.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  readRepoFile,
  writeRepoFile,
  getRepoTree,
  getGitStatus,
  getGitDiff,
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

export interface McpServer {
  id: string;
  name: string;
  description: string;
  transport: 'builtin' | 'sse' | 'http';
  endpoint?: string;
  status: 'connected' | 'disconnected' | 'error';
  is_enabled: boolean;
  tools: McpToolDefinition[];
  created_at: string;
}

// Built-in MCP Servers definitions
const BUILTIN_SERVERS: McpServer[] = [
  {
    id: 'mcp_filesystem',
    name: 'Filesystem MCP',
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
    id: 'mcp_cloudflare_d1',
    name: 'Cloudflare D1 & Edge MCP',
    description: 'Inspect Cloudflare D1 migrations, SQLite schemas, and Edge Worker configurations',
    transport: 'builtin',
    status: 'connected',
    is_enabled: true,
    created_at: new Date().toISOString(),
    tools: [
      {
        name: 'd1_list_migrations',
        description: 'List all SQL migration files in /migrations directory and their schema structures',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    ],
  },
  {
    id: 'mcp_web_recon',
    name: 'Web Intelligence Recon MCP',
    description: 'Perform real-world website reconnaissance, DNS inspection, and security analysis',
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
];

class McpManager {
  private servers: Map<string, McpServer> = new Map();

  constructor() {
    for (const s of BUILTIN_SERVERS) {
      this.servers.set(s.id, { ...s });
    }
  }

  public getServers(): McpServer[] {
    return Array.from(this.servers.values());
  }

  public getServer(id: string): McpServer | undefined {
    return this.servers.get(id);
  }

  public getAllTools(): Array<{ serverId: string; serverName: string; tool: McpToolDefinition }> {
    const list: Array<{ serverId: string; serverName: string; tool: McpToolDefinition }> = [];
    for (const server of this.servers.values()) {
      if (!server.is_enabled) continue;
      for (const tool of server.tools) {
        list.push({
          serverId: server.id,
          serverName: server.name,
          tool,
        });
      }
    }
    return list;
  }

  public addCustomServer(params: {
    name: string;
    description: string;
    endpoint: string;
    transport?: 'sse' | 'http';
  }): McpServer {
    const id = `mcp_ext_${Date.now()}`;
    const newServer: McpServer = {
      id,
      name: params.name,
      description: params.description || 'External MCP Server',
      transport: params.transport || 'http',
      endpoint: params.endpoint,
      status: 'connected',
      is_enabled: true,
      created_at: new Date().toISOString(),
      tools: [
        {
          name: 'query_custom_mcp',
          description: `Execute remote action on ${params.name}`,
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Action name' },
              payload: { type: 'string', description: 'JSON stringified payload' },
            },
            required: ['action'],
          },
        },
      ],
    };

    this.servers.set(id, newServer);
    return newServer;
  }

  public toggleServer(id: string, enabled: boolean): boolean {
    const server = this.servers.get(id);
    if (!server) return false;
    server.is_enabled = enabled;
    return true;
  }

  public removeCustomServer(id: string): boolean {
    if (this.servers.get(id)?.transport === 'builtin') {
      return false; // Can't remove builtin
    }
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
          const res = await pushGit({
            branch: args.branch,
            token: args.token,
          });
          return { success: true, result: res };
        }

        // --- Cloudflare D1 MCP ---
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

        // --- Web Recon MCP ---
        case 'investigate_domain': {
          if (!args.target) throw new Error('Missing target URL');
          const recon = await runWebInvestigation({ target: args.target, timeout_ms: 5000 });
          return { success: true, result: recon };
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
