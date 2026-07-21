import { CopilotOtelConfig } from './config';

/**
 * Pure formatting for the panel Storage Footer's Copilot OTel awareness line
 * (plan_v2 "Panel status", surfaces-and-privacy.md "Storage Footer"). Combines
 * the detected config state with runtime facts into one compact line, plus the
 * footer's storage-guarantee/retention sub-line. Kept pure and tested; the
 * webview only renders the strings.
 */

export interface CopilotOtelRuntime {
  /** The loopback receiver is bound and listening. */
  receiverActive: boolean;
  /** Bytes of the extension's own normalized OTel store. */
  storageBytes: number;
  /** A storage read/write error occurred. */
  storageError?: boolean;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${value >= 100 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`;
}

/** The compact "Copilot detail: …" status line. */
export function copilotOtelFooterLine(config: CopilotOtelConfig, runtime: CopilotOtelRuntime): string {
  const prefix = 'Copilot detail:';
  const history = `local usage history ${formatBytes(runtime.storageBytes)}`;

  switch (config.kind) {
    case 'disabled':
    case 'wrong-exporter':
    case 'endpoint-missing':
      return `${prefix} inactive`;
    case 'managed-disabled':
      return `${prefix} inactive (managed by organization)`;
    case 'endpoint-elsewhere':
      return `${prefix} exporting elsewhere`;
    case 'loopback': {
      if (runtime.storageError) return `${prefix} storage unavailable`;
      if (!runtime.receiverActive) return `${prefix} receiver unavailable (port in use)`;
      const lead = config.managed ? 'managed by organization' : 'active';
      if (runtime.storageBytes <= 0) return `${prefix} ${lead} · no compatible spans received`;
      return `${prefix} ${lead} · ${history}`;
    }
  }
}

/**
 * Both footer lines: the OTel status line, then the storage guarantee (when the
 * extension has persisted nothing) or the retention note (when it has).
 */
export function buildStorageFooterLines(config: CopilotOtelConfig, runtime: CopilotOtelRuntime): string[] {
  const otel = copilotOtelFooterLine(config, runtime);
  const persisted = runtime.storageBytes > 0 && !runtime.storageError;
  const second = persisted
    ? 'Local usage history is the extension’s own Copilot OpenTelemetry store, retained for the current and two preceding calendar months. Provider logs are read directly and never copied.'
    : 'No local data stored — Agent Context Trail reads provider logs directly and writes nothing of its own to disk.';
  return [otel, second];
}
