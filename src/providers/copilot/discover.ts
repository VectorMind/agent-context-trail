import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as url from 'url';
import { ConversationListItem } from '../../domain/types';
import { PricingService } from '../../pricing/pricingService';
import { scanCopilotSessionMeta } from './parser';

function vscodeUserDataRoot(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Code', 'User');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User');
  }
  return path.join(os.homedir(), '.config', 'Code', 'User');
}

function workspaceStorageRoot(): string {
  return path.join(vscodeUserDataRoot(), 'workspaceStorage');
}

function normalizeForCompare(p: string): string {
  return path.resolve(p).replace(/\//g, '\\').toLowerCase();
}

/** workspaceStorage/<hash> folder for a workspace path, keyed by resolved path; VS Code never moves an existing storage folder mid-session. */
const storageDirCache = new Map<string, string | undefined>();

/**
 * VS Code names each workspaceStorage folder after an opaque hash, and
 * records the workspace it belongs to in that folder's own `workspace.json`
 * (`{"folder": "file:///c%3A/dev/..."}`). There is no faster lookup than
 * scanning every folder's `workspace.json` once per resolution.
 */
export function findCopilotWorkspaceStorageDir(workspacePath: string): string | undefined {
  const normalized = normalizeForCompare(workspacePath);
  if (storageDirCache.has(normalized)) return storageDirCache.get(normalized);

  const root = workspaceStorageRoot();
  let match: string | undefined;
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(root, entry.name);
      const workspaceJsonPath = path.join(dirPath, 'workspace.json');
      if (!fs.existsSync(workspaceJsonPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf8')) as { folder?: string };
        if (!meta.folder) continue;
        const folderPath = url.fileURLToPath(meta.folder);
        if (normalizeForCompare(folderPath) === normalized) {
          match = dirPath;
          break;
        }
      } catch {
        // tolerate unreadable/corrupt workspace.json during discovery
      }
    }
  }

  storageDirCache.set(normalized, match);
  return match;
}

export interface CopilotSessionFile {
  sessionId: string;
  filePath: string;
  mtimeMs: number;
}

export function listCopilotSessions(workspacePath: string): CopilotSessionFile[] {
  const storageDir = findCopilotWorkspaceStorageDir(workspacePath);
  if (!storageDir) return [];
  const chatSessionsDir = path.join(storageDir, 'chatSessions');
  if (!fs.existsSync(chatSessionsDir)) return [];

  return fs
    .readdirSync(chatSessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => {
      const filePath = path.join(chatSessionsDir, entry.name);
      const stat = fs.statSync(filePath);
      return { sessionId: entry.name.replace(/\.jsonl$/, ''), filePath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

const filePathBySessionId = new Map<string, string>();

export function getCopilotSessionFilePath(sessionId: string): string | undefined {
  return filePathBySessionId.get(sessionId);
}

/** Scan results keyed by file path; invalidated when the file's mtime moves. */
const metaCache = new Map<string, { mtimeMs: number; item: ConversationListItem }>();

export async function listCopilotConversations(
  workspacePath: string,
  pricing: PricingService
): Promise<ConversationListItem[]> {
  const sessions = listCopilotSessions(workspacePath);
  const items: ConversationListItem[] = [];

  for (const session of sessions) {
    filePathBySessionId.set(session.sessionId, session.filePath);
    const cached = metaCache.get(session.filePath);
    if (cached && cached.mtimeMs === session.mtimeMs) {
      items.push(cached.item);
      continue;
    }

    const meta = await scanCopilotSessionMeta(session.filePath, pricing);
    if (meta.requestCount === 0) continue;

    const mtimeIso = new Date(session.mtimeMs).toISOString();
    const item: ConversationListItem = {
      id: session.sessionId,
      title: meta.title ?? '(untitled)',
      updatedAt: mtimeIso,
      firstAt: meta.firstAt,
      lastAt: meta.lastAt ?? mtimeIso,
      requestCount: meta.requestCount,
      totalUsage: meta.totalUsage,
      totalTokens:
        meta.totalUsage.inputTokens + meta.totalUsage.cacheReadTokens + meta.totalUsage.cacheCreationTokens + meta.totalUsage.outputTokens,
      totalCostUsd: meta.totalCostUsd
    };
    metaCache.set(session.filePath, { mtimeMs: session.mtimeMs, item });
    items.push(item);
  }

  return items.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
