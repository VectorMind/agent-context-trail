import * as fs from 'fs';
import * as path from 'path';
import { NormalizedCall, SUPPORTED_OTEL_SCHEMA_VERSIONS } from './types';

/**
 * Daily-partitioned JSONL storage for normalized Copilot OTel calls (plan_v2
 * Phase 4). This is the extension's first persisted artifact, so it obeys the
 * Storage Footer + Data Retention contract in surfaces-and-privacy.md: it holds
 * only allowlisted normalized records (never raw OTLP or content), lives under
 * the extension's own storage directory, and is bounded by the retention module.
 *
 * Layout:  <baseDir>/copilot-otel/YYYY-MM-DD.jsonl   (one call per line)
 *
 * Partitioning is by the call's own UTC date (OP-006: UTC chosen for stable,
 * timezone-independent partitions; revisit if reporting semantics require
 * local-calendar days). Files are append-only during ingestion; whole
 * partitions are deleted by retention, never rewritten.
 */

export const OTEL_STORAGE_SUBDIR = 'copilot-otel';
const PARTITION_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export function otelStorageDir(baseDir: string): string {
  return path.join(baseDir, OTEL_STORAGE_SUBDIR);
}

/** UTC calendar day of an ISO timestamp, e.g. "2026-07-20". */
function utcDate(isoTimestamp: string): string | undefined {
  const d = isoTimestamp.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

export interface PartitionInfo {
  date: string;
  filePath: string;
  bytes: number;
}

/**
 * Append normalized calls to their UTC-day partitions. Groups by day so a batch
 * spanning midnight lands in the right files. Creates the storage dir on demand.
 * Append-only; callers dedupe on read.
 */
export function appendCalls(baseDir: string, calls: NormalizedCall[]): void {
  if (calls.length === 0) return;
  const dir = otelStorageDir(baseDir);
  fs.mkdirSync(dir, { recursive: true });

  const byDay = new Map<string, string[]>();
  for (const call of calls) {
    const day = utcDate(call.timestamp);
    if (!day) continue; // skip records without a usable timestamp
    const line = JSON.stringify(call);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(line);
    else byDay.set(day, [line]);
  }

  for (const [day, lines] of byDay) {
    fs.appendFileSync(path.join(dir, `${day}.jsonl`), lines.join('\n') + '\n', 'utf8');
  }
}

/** List day partitions oldest-first, with byte sizes. */
export function listPartitions(baseDir: string): PartitionInfo[] {
  const dir = otelStorageDir(baseDir);
  if (!fs.existsSync(dir)) return [];
  const out: PartitionInfo[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const m = PARTITION_RE.exec(entry.name);
    if (!m) continue;
    const filePath = path.join(dir, entry.name);
    let bytes = 0;
    try {
      bytes = fs.statSync(filePath).size;
    } catch {
      continue;
    }
    out.push({ date: m[1], filePath, bytes });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Total bytes of the extension's own OTel storage (for the Storage Footer). */
export function storageBytes(baseDir: string): number {
  return listPartitions(baseDir).reduce((sum, p) => sum + p.bytes, 0);
}

/**
 * Read all normalized calls across partitions. Tolerates a partial trailing
 * line (interrupted write), skips unparseable or wrong-schema lines, and
 * dedupes by spanId (duplicate exports/retries keep the first seen).
 */
export function readAllCalls(baseDir: string): NormalizedCall[] {
  const seen = new Set<string>();
  const out: NormalizedCall[] = [];
  for (const partition of listPartitions(baseDir)) {
    let content: string;
    try {
      content = fs.readFileSync(partition.filePath, 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let call: NormalizedCall;
      try {
        call = JSON.parse(trimmed) as NormalizedCall;
      } catch {
        continue; // partial trailing line or corruption
      }
      if (!SUPPORTED_OTEL_SCHEMA_VERSIONS.has(call.schemaVersion)) continue;
      if (!call.spanId || seen.has(call.spanId)) continue;
      seen.add(call.spanId);
      out.push(call);
    }
  }
  return out;
}

/** All calls for one conversation id (deduped), request/round order left to the caller. */
export function readCallsForConversation(baseDir: string, conversationId: string): NormalizedCall[] {
  return readAllCalls(baseDir).filter((c) => c.conversationId === conversationId);
}
