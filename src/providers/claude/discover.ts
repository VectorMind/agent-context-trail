import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function claudeProjectsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Claude Code names each project directory after the workspace's absolute
 * path with `:` and path separators replaced by `-` (e.g.
 * `C:\dev\foo\bar` -> `C--dev-foo-bar`). This is a fast-path guess, not a
 * guarantee — see the cwd fallback in findClaudeProjectDir.
 */
export function slugifyWorkspacePath(workspacePath: string): string {
  return workspacePath.replace(/[:\\/]/g, '-');
}

function readFirstLine(filePath: string): string | undefined {
  const fd = fs.openSync(filePath, 'r');
  try {
    const bufferSize = 4096;
    const buffer = Buffer.alloc(bufferSize);
    let content = '';
    let bytesRead: number;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, bufferSize, null);
      content += buffer.toString('utf8', 0, bytesRead);
      const newlineIndex = content.indexOf('\n');
      if (newlineIndex !== -1) {
        return content.slice(0, newlineIndex);
      }
    } while (bytesRead > 0);
    return content || undefined;
  } finally {
    fs.closeSync(fd);
  }
}

function directoryMatchesCwd(projectDir: string, normalizedWorkspacePath: string): boolean {
  const files = fs
    .readdirSync(projectDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'));
  for (const file of files) {
    try {
      const firstLine = readFirstLine(path.join(projectDir, file.name));
      if (!firstLine) continue;
      const record = JSON.parse(firstLine) as { cwd?: string };
      if (record.cwd && path.resolve(record.cwd) === normalizedWorkspacePath) {
        return true;
      }
    } catch {
      // Tolerate unreadable/corrupt session files during discovery.
    }
  }
  return false;
}

/**
 * Resolves the Claude Code project directory for a workspace path. Tries
 * the slug fast path first (both as-is and with a lowercased drive letter,
 * since Node's process.cwd() casing varies by how the process was
 * launched), then falls back to scanning project directories and matching
 * the `cwd` field recorded in each session file.
 */
export function findClaudeProjectDir(workspacePath: string): string | undefined {
  const root = claudeProjectsRoot();
  if (!fs.existsSync(root)) return undefined;

  const normalized = path.resolve(workspacePath);

  const candidates = [
    slugifyWorkspacePath(normalized),
    slugifyWorkspacePath(normalized.charAt(0).toLowerCase() + normalized.slice(1))
  ];
  for (const candidate of candidates) {
    const candidatePath = path.join(root, candidate);
    if (fs.existsSync(candidatePath)) return candidatePath;
  }

  const projectDirs = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const dir of projectDirs) {
    const dirPath = path.join(root, dir.name);
    if (directoryMatchesCwd(dirPath, normalized)) return dirPath;
  }

  return undefined;
}

export interface ClaudeSessionFile {
  sessionId: string;
  filePath: string;
  mtimeMs: number;
}

export function listClaudeSessions(projectDir: string): ClaudeSessionFile[] {
  return fs
    .readdirSync(projectDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => {
      const filePath = path.join(projectDir, entry.name);
      const stat = fs.statSync(filePath);
      return {
        sessionId: entry.name.replace(/\.jsonl$/, ''),
        filePath,
        mtimeMs: stat.mtimeMs
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function findLatestClaudeSession(workspacePath: string): ClaudeSessionFile | undefined {
  const projectDir = findClaudeProjectDir(workspacePath);
  if (!projectDir) return undefined;
  return listClaudeSessions(projectDir)[0];
}
