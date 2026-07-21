import * as fs from 'fs';
import { listPartitions, PartitionInfo } from './storage';

/**
 * Retention & pruning for the OTel JSONL store (plan_v2 "Retention And Cleanup",
 * surfaces-and-privacy.md "Data Retention"). Two policies:
 *
 *  - Time (normal): keep whole calendar months — the current month plus the two
 *    preceding complete months (three calendar periods, not a fixed 90 days).
 *    Everything in an older month is a whole-partition delete.
 *  - Size (safeguard): a hard cap against exporter loops / abnormal volume.
 *    After time pruning, if the store still exceeds the cap, delete oldest
 *    surviving partitions first (targeting the safety period, preserving the
 *    current and previous reporting months where possible) until under the cap.
 *
 * The planner is pure and fully tested; the executor deletes whole partitions
 * and reports every removal so retention is observable, never silent.
 */

export const DEFAULT_RETAIN_MONTHS = 3;
export const DEFAULT_CAP_BYTES = 250 * 1024 * 1024; // 250 MB, provisional (OP-007)

export interface RetentionOptions {
  /** Number of calendar months to keep, including the current one. */
  retainMonths?: number;
  /** Hard storage cap in bytes. */
  capBytes?: number;
}

export interface PruneEntry extends PartitionInfo {
  reason: 'time' | 'size';
  ageDays: number;
}

export interface RetentionPlan {
  /** First calendar day kept, "YYYY-MM-01". Partitions before this are time-expired. */
  cutoffDate: string;
  capBytes: number;
  bytesBefore: number;
  bytesAfter: number;
  remove: PruneEntry[];
  retained: PartitionInfo[];
}

/** First day ("YYYY-MM-01") of the oldest retained calendar month. */
export function retentionCutoff(now: Date, retainMonths: number): string {
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - (retainMonths - 1);
  const year = Math.floor(total / 12);
  const month = total - year * 12; // 0-based, always >= 0
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`;
}

function ageDays(date: string, now: Date): number {
  const then = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(then) ? Math.max(Math.floor((now.getTime() - then) / 86_400_000), 0) : 0;
}

/** Compute what to delete. Pure — no filesystem access. */
export function planRetention(
  partitions: PartitionInfo[],
  now: Date,
  options: RetentionOptions = {}
): RetentionPlan {
  const retainMonths = options.retainMonths ?? DEFAULT_RETAIN_MONTHS;
  const capBytes = options.capBytes ?? DEFAULT_CAP_BYTES;
  const cutoffDate = retentionCutoff(now, retainMonths);

  const sorted = [...partitions].sort((a, b) => a.date.localeCompare(b.date));
  const bytesBefore = sorted.reduce((s, p) => s + p.bytes, 0);

  const remove: PruneEntry[] = [];
  const survivors: PartitionInfo[] = [];
  for (const p of sorted) {
    if (p.date < cutoffDate) remove.push({ ...p, reason: 'time', ageDays: ageDays(p.date, now) });
    else survivors.push(p);
  }

  // Size safeguard: drop oldest survivors first until under the cap.
  let survivingBytes = survivors.reduce((s, p) => s + p.bytes, 0);
  const retained: PartitionInfo[] = [...survivors];
  while (survivingBytes > capBytes && retained.length > 0) {
    const oldest = retained.shift() as PartitionInfo;
    survivingBytes -= oldest.bytes;
    remove.push({ ...oldest, reason: 'size', ageDays: ageDays(oldest.date, now) });
  }

  return {
    cutoffDate,
    capBytes,
    bytesBefore,
    bytesAfter: retained.reduce((s, p) => s + p.bytes, 0),
    remove,
    retained
  };
}

export type PruneLogger = (message: string) => void;

/**
 * Execute retention against the store: plan, delete whole partitions, and log
 * each removal (date, age, bytes, reason). Returns the plan for reporting.
 */
export function runRetention(
  baseDir: string,
  now: Date = new Date(),
  options: RetentionOptions = {},
  log?: PruneLogger
): RetentionPlan {
  const plan = planRetention(listPartitions(baseDir), now, options);
  for (const entry of plan.remove) {
    try {
      fs.rmSync(entry.filePath, { force: true });
      log?.(
        `[copilot-otel retention] removed ${entry.date}.jsonl (${entry.reason}, age ${entry.ageDays}d, ${entry.bytes} bytes)`
      );
    } catch (err) {
      log?.(`[copilot-otel retention] failed to remove ${entry.filePath}: ${(err as Error).message}`);
    }
  }
  return plan;
}
