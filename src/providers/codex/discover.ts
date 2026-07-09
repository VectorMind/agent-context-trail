import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConversationListItem, RateLimitStatus } from '../../domain/types';
import { PricingService } from '../../pricing/pricingService';
import { scanCodexSessionMeta } from './parser';

interface SessionIndexEntry {
  thread_name?: string;
  updated_at?: string;
}

interface CodexSessionFile {
  sessionId: string;
  filePath: string;
  mtimeMs: number;
}

interface CachedMeta {
  title?: string;
  firstAt?: string;
  lastAt?: string;
  requestCount: number;
  totalUsage: ConversationListItem['totalUsage'];
  totalCostUsd: number;
  workspacePath?: string;
  latestRateLimits?: RateLimitStatus;
}

const metaCache = new Map<string, { mtimeMs: number; meta: CachedMeta }>();
const filePathBySessionId = new Map<string, string>();
let sessionIndexCache:
  | {
      mtimeMs: number;
      entries: Map<string, SessionIndexEntry>;
    }
  | undefined;

function codexRoot(): string {
  return path.join(os.homedir(), '.codex');
}

function codexSessionsRoot(): string {
  return path.join(codexRoot(), 'sessions');
}

function sessionIndexPath(): string {
  return path.join(codexRoot(), 'session_index.jsonl');
}

function normalizeForCompare(filePath: string): string {
  return path.resolve(filePath).replace(/\//g, '\\').toLowerCase();
}

function isWithinWorkspace(candidatePath: string, workspacePath: string): boolean {
  const candidate = normalizeForCompare(candidatePath);
  const workspace = normalizeForCompare(workspacePath);
  return candidate === workspace || candidate.startsWith(`${workspace}\\`);
}

function relativePathLabel(candidatePath: string, workspacePath: string): string {
  const relative = path.relative(workspacePath, candidatePath);
  return relative && relative !== '' ? relative.replace(/\//g, '\\') : '.';
}

function readSessionIndex(): Map<string, SessionIndexEntry> {
  const filePath = sessionIndexPath();
  if (!fs.existsSync(filePath)) return new Map();
  const stat = fs.statSync(filePath);
  if (sessionIndexCache && sessionIndexCache.mtimeMs === stat.mtimeMs) return sessionIndexCache.entries;

  const entries = new Map<string, SessionIndexEntry>();
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as { id?: string; thread_name?: string; updated_at?: string };
      if (record.id) {
        entries.set(record.id, { thread_name: record.thread_name, updated_at: record.updated_at });
      }
    } catch {
      // tolerate partially written index lines
    }
  }

  sessionIndexCache = { mtimeMs: stat.mtimeMs, entries };
  return entries;
}

function walkRolloutFiles(rootDir: string): CodexSessionFile[] {
  if (!fs.existsSync(rootDir)) return [];
  const found: CodexSessionFile[] = [];
  const visit = (dirPath: string) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.startsWith('rollout-') || !entry.name.endsWith('.jsonl')) continue;
      const stat = fs.statSync(fullPath);
      const match = entry.name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
      const sessionId = match?.[1];
      if (!sessionId) continue;
      found.push({ sessionId, filePath: fullPath, mtimeMs: stat.mtimeMs });
    }
  };
  visit(rootDir);
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found;
}

export function getCodexSessionFilePath(sessionId: string): string | undefined {
  return filePathBySessionId.get(sessionId);
}

async function getSessionMeta(
  session: CodexSessionFile,
  titleFromIndex: string | undefined,
  pricing: PricingService
): Promise<CachedMeta> {
  const cached = metaCache.get(session.filePath);
  const meta =
    cached && cached.mtimeMs === session.mtimeMs
      ? cached.meta
      : await scanCodexSessionMeta(session.filePath, titleFromIndex, pricing);
  if (titleFromIndex && meta.title !== titleFromIndex) {
    meta.title = titleFromIndex;
  }
  if (!(cached && cached.mtimeMs === session.mtimeMs)) {
    metaCache.set(session.filePath, { mtimeMs: session.mtimeMs, meta });
  }
  return meta;
}

export async function listCodexConversations(workspacePath: string, pricing: PricingService): Promise<ConversationListItem[]> {
  const sessions = walkRolloutFiles(codexSessionsRoot());
  const titles = readSessionIndex();
  const items: ConversationListItem[] = [];

  for (const session of sessions) {
    const titleFromIndex = titles.get(session.sessionId)?.thread_name;
    const meta = await getSessionMeta(session, titleFromIndex, pricing);
    if (!meta.workspacePath || !isWithinWorkspace(meta.workspacePath, workspacePath)) continue;

    const item: ConversationListItem = {
      id: session.sessionId,
      title: meta.title ?? '(untitled)',
      updatedAt: meta.lastAt ?? new Date(session.mtimeMs).toISOString(),
      firstAt: meta.firstAt,
      lastAt: meta.lastAt ?? new Date(session.mtimeMs).toISOString(),
      requestCount: meta.requestCount,
      totalUsage: meta.totalUsage,
      totalTokens:
        meta.totalUsage.inputTokens + meta.totalUsage.cacheReadTokens + meta.totalUsage.cacheCreationTokens + meta.totalUsage.outputTokens,
      totalCostUsd: meta.totalCostUsd,
      pathLabel: relativePathLabel(meta.workspacePath, workspacePath)
    };
    filePathBySessionId.set(session.sessionId, session.filePath);
    items.push(item);
  }

  return items.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export async function getLatestCodexRateLimits(workspacePath: string, pricing: PricingService): Promise<RateLimitStatus | undefined> {
  const sessions = walkRolloutFiles(codexSessionsRoot());
  const titles = readSessionIndex();
  let latest:
    | {
        observedAt: string;
        rateLimits: RateLimitStatus;
      }
    | undefined;

  for (const session of sessions) {
    const titleFromIndex = titles.get(session.sessionId)?.thread_name;
    const meta = await getSessionMeta(session, titleFromIndex, pricing);
    if (!meta.workspacePath || !isWithinWorkspace(meta.workspacePath, workspacePath) || !meta.latestRateLimits) continue;

    const observedAt = meta.latestRateLimits.observedAt ?? meta.lastAt ?? new Date(session.mtimeMs).toISOString();
    if (!latest || observedAt.localeCompare(latest.observedAt) > 0) {
      latest = { observedAt, rateLimits: meta.latestRateLimits };
    }
  }

  return latest?.rateLimits;
}
