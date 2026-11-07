/**
 * Repository and Git Operations Service for AetherOS
 * Safely reads repo files, performs git status, diff, commit, and push operations.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export const WORKSPACE_ROOT = process.cwd();

export interface RepoFileNode {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size?: number;
  extension?: string;
  children?: RepoFileNode[];
}

export interface GitStatusResult {
  branch: string;
  clean: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
  ahead: number;
  behind: number;
  remoteUrl?: string;
}

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.cache',
  '.wrangler',
  '.turbo',
  'build',
  '.vscode',
  '.idea',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
  '.pdf', '.zip', '.tar', '.gz', '.mp4', '.mp3', '.woff', '.woff2', '.ttf', '.eot'
]);

function isSafePath(targetPath: string): boolean {
  const resolved = path.resolve(WORKSPACE_ROOT, targetPath);
  return resolved.startsWith(WORKSPACE_ROOT);
}

/**
 * Builds a hierarchical tree of files in the workspace
 */
export async function getRepoTree(maxDepth = 4): Promise<RepoFileNode[]> {
  async function walk(currentDir: string, depth: number): Promise<RepoFileNode[]> {
    if (depth > maxDepth) return [];
    try {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      const nodes: RepoFileNode[] = [];

      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.env.example' && entry.name !== '.gitignore') continue;

        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(WORKSPACE_ROOT, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          const children = await walk(fullPath, depth + 1);
          nodes.push({
            path: relPath,
            name: entry.name,
            type: 'dir',
            children,
          });
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          let size = 0;
          try {
            const stat = await fs.promises.stat(fullPath);
            size = stat.size;
          } catch {}

          nodes.push({
            path: relPath,
            name: entry.name,
            type: 'file',
            size,
            extension: ext,
          });
        }
      }

      // Sort: directories first, then files alphabetically
      nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'dir' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return nodes;
    } catch {
      return [];
    }
  }

  return walk(WORKSPACE_ROOT, 0);
}

/**
 * Safely reads a file's content
 */
export async function readRepoFile(relPath: string): Promise<{
  path: string;
  content: string;
  size: number;
  isBinary: boolean;
  language: string;
}> {
  if (!isSafePath(relPath)) {
    throw new Error('Access denied: Path outside workspace root');
  }

  const fullPath = path.resolve(WORKSPACE_ROOT, relPath);
  const ext = path.extname(fullPath).toLowerCase();
  const isBinary = BINARY_EXTENSIONS.has(ext);

  if (isBinary) {
    return {
      path: relPath,
      content: '[Binary File Preview Not Supported]',
      size: 0,
      isBinary: true,
      language: ext.slice(1),
    };
  }

  const stat = await fs.promises.stat(fullPath);
  const content = await fs.promises.readFile(fullPath, 'utf-8');

  let language = 'plaintext';
  if (ext === '.ts' || ext === '.tsx') language = 'typescript';
  else if (ext === '.js' || ext === '.jsx') language = 'javascript';
  else if (ext === '.json') language = 'json';
  else if (ext === '.html') language = 'html';
  else if (ext === '.css') language = 'css';
  else if (ext === '.py') language = 'python';
  else if (ext === '.sql') language = 'sql';
  else if (ext === '.md') language = 'markdown';
  else if (ext === '.sh') language = 'shell';

  return {
    path: relPath,
    content,
    size: stat.size,
    isBinary: false,
    language,
  };
}

/**
 * Safely writes/creates a file
 */
export async function writeRepoFile(relPath: string, content: string): Promise<{
  path: string;
  size: number;
}> {
  if (!isSafePath(relPath)) {
    throw new Error('Access denied: Path outside workspace root');
  }

  const fullPath = path.resolve(WORKSPACE_ROOT, relPath);
  const dir = path.dirname(fullPath);

  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(fullPath, content, 'utf-8');
  const stat = await fs.promises.stat(fullPath);

  return {
    path: relPath,
    size: stat.size,
  };
}

/**
 * Retrieves git status
 */
export async function getGitStatus(): Promise<GitStatusResult> {
  try {
    let branch = 'main';
    try {
      const { stdout: branchOut } = await execFileAsync('git', ['branch', '--show-current'], { cwd: WORKSPACE_ROOT });
      branch = branchOut.trim() || 'main';
    } catch {}

    let remoteUrl: string | undefined;
    try {
      const { stdout: remoteOut } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: WORKSPACE_ROOT });
      remoteUrl = remoteOut.trim();
    } catch {}

    const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain=v1', '-b'], { cwd: WORKSPACE_ROOT });
    const lines = statusOut.split('\n').filter(Boolean);

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];
    let ahead = 0;
    let behind = 0;

    for (const line of lines) {
      if (line.startsWith('##')) {
        const aheadMatch = line.match(/ahead (\d+)/);
        const behindMatch = line.match(/behind (\d+)/);
        if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
        if (behindMatch) behind = parseInt(behindMatch[1], 10);
        continue;
      }

      const x = line[0];
      const y = line[1];
      const filePath = line.slice(3).trim();

      if (x === '?' && y === '?') {
        untracked.push(filePath);
      } else {
        if (x !== ' ' && x !== '?') {
          staged.push(filePath);
        }
        if (y !== ' ' && y !== '?') {
          modified.push(filePath);
        }
      }
    }

    return {
      branch,
      clean: staged.length === 0 && modified.length === 0 && untracked.length === 0,
      staged,
      modified,
      untracked,
      ahead,
      behind,
      remoteUrl,
    };
  } catch (err: any) {
    return {
      branch: 'main',
      clean: true,
      staged: [],
      modified: [],
      untracked: [],
      ahead: 0,
      behind: 0,
    };
  }
}

/**
 * Gets git diff for working tree
 */
export async function getGitDiff(filePath?: string): Promise<{ diff: string }> {
  try {
    const args = ['diff'];
    if (filePath) {
      if (!isSafePath(filePath)) throw new Error('Invalid path');
      args.push(filePath);
    }
    const { stdout } = await execFileAsync('git', args, { cwd: WORKSPACE_ROOT });
    return { diff: stdout || '(No unstaged changes)' };
  } catch (err: any) {
    return { diff: `Error generating diff: ${err.message}` };
  }
}

/**
 * Stages files for commit
 */
export async function stageGitFiles(paths?: string[]): Promise<{ success: boolean; stagedCount: number }> {
  if (!paths || paths.length === 0) {
    await execFileAsync('git', ['add', '-A'], { cwd: WORKSPACE_ROOT });
    return { success: true, stagedCount: 0 };
  }

  for (const p of paths) {
    if (!isSafePath(p)) throw new Error(`Invalid path: ${p}`);
  }
  await execFileAsync('git', ['add', ...paths], { cwd: WORKSPACE_ROOT });
  return { success: true, stagedCount: paths.length };
}

/**
 * Commits staged changes
 */
export async function commitGit(message: string, stageAll = true): Promise<{
  success: boolean;
  commitHash: string;
  message: string;
}> {
  if (!message.trim()) {
    throw new Error('Commit message is required');
  }

  if (stageAll) {
    await execFileAsync('git', ['add', '-A'], { cwd: WORKSPACE_ROOT });
  }

  const { stdout } = await execFileAsync('git', ['commit', '-m', message.trim()], { cwd: WORKSPACE_ROOT });
  
  let commitHash = 'unknown';
  try {
    const { stdout: revOut } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: WORKSPACE_ROOT });
    commitHash = revOut.trim();
  } catch {}

  return {
    success: true,
    commitHash,
    message: message.trim(),
  };
}

/**
 * Pushes commits to remote
 */
export async function pushGit(params: {
  branch?: string;
  remote?: string;
  token?: string;
}): Promise<{
  success: boolean;
  output: string;
}> {
  const branch = params.branch || 'main';
  const remote = params.remote || 'origin';

  let pushTarget = remote;
  if (params.token) {
    // Read origin URL
    const { stdout: remoteUrlOut } = await execFileAsync('git', ['remote', 'get-url', remote], { cwd: WORKSPACE_ROOT });
    const cleanUrl = remoteUrlOut.trim();
    if (cleanUrl.startsWith('https://github.com/')) {
      pushTarget = cleanUrl.replace('https://', `https://${params.token.trim()}@`);
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync('git', ['push', pushTarget, branch], { cwd: WORKSPACE_ROOT });
    return {
      success: true,
      output: (stdout + '\n' + stderr).trim() || 'Push completed successfully',
    };
  } catch (err: any) {
    // Redact token from any error message
    let sanitizedErr = err.message || 'Push failed';
    if (params.token) {
      sanitizedErr = sanitizedErr.split(params.token.trim()).join('***');
    }
    throw new Error(sanitizedErr);
  }
}

/**
 * Retrieves recent git commit log entries
 */
export async function getGitLog(limit = 10): Promise<
  Array<{
    hash: string;
    shortHash: string;
    author: string;
    date: string;
    subject: string;
  }>
> {
  try {
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
    const { stdout } = await execFileAsync(
      'git',
      ['log', `-n`, String(safeLimit), '--pretty=format:%H|%h|%an|%ai|%s'],
      { cwd: WORKSPACE_ROOT }
    );
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, author, date, ...subjectParts] = line.split('|');
        return {
          hash: hash || '',
          shortHash: shortHash || '',
          author: author || '',
          date: date || '',
          subject: subjectParts.join('|') || '',
        };
      });
  } catch {
    return [];
  }
}

/**
 * Lists local and remote git branches
 */
export async function getGitBranches(): Promise<{
  current: string;
  local: string[];
  remote: string[];
}> {
  try {
    const { stdout: currentOut } = await execFileAsync('git', ['branch', '--show-current'], { cwd: WORKSPACE_ROOT });
    const { stdout: localOut } = await execFileAsync('git', ['branch', '--format=%(refname:short)'], { cwd: WORKSPACE_ROOT });
    const { stdout: remoteOut } = await execFileAsync('git', ['branch', '-r', '--format=%(refname:short)'], {
      cwd: WORKSPACE_ROOT,
    });
    return {
      current: currentOut.trim() || 'main',
      local: localOut.split('\n').map((s) => s.trim()).filter(Boolean),
      remote: remoteOut.split('\n').map((s) => s.trim()).filter(Boolean),
    };
  } catch {
    return { current: 'main', local: ['main'], remote: ['origin/main'] };
  }
}

