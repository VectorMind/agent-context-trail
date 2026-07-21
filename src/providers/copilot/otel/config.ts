/**
 * Copilot OTel enrichment — configuration + state detection (plan_v2 Phase 2/7).
 *
 * Classifies the *resolved* `github.copilot.chat.otel.*` settings into one
 * honest state. The v2 design consumes the OTLP/HTTP exporter pointed at a
 * loopback endpoint the extension hosts; the extension only reads settings and
 * never writes a `github.copilot.*` value (surfaces-and-privacy.md).
 *
 * Pure and fully unit-tested; the `vscode`/`fs` adapter lives in `detect.ts`.
 */

const DOCS_URL = 'https://code.visualstudio.com/docs/agents/guides/monitoring-agents';

/** The exporter type this integration consumes. */
export const REQUIRED_EXPORTER_TYPE = 'otlp-http';

export interface CopilotOtelProbe {
  enabled?: boolean;
  /** policyValue of `enabled` when VS Code exposes one (enterprise policy). */
  enabledByPolicy?: boolean;
  exporterType?: string;
  /** github.copilot.chat.otel.otlpEndpoint, e.g. "http://127.0.0.1:9876". */
  otlpEndpoint?: string;
  captureContent?: boolean;
}

export type CopilotOtelConfigKind =
  /** enabled is not true and no policy forces it off. */
  | 'disabled'
  /** enterprise policy forces OTel off — honest admin-owned state, not an error. */
  | 'managed-disabled'
  /** enabled, but the exporter is not otlp-http. */
  | 'wrong-exporter'
  /** otlp-http selected, but no endpoint is configured. */
  | 'endpoint-missing'
  /** otlp-http endpoint points somewhere other than loopback — left untouched. */
  | 'endpoint-elsewhere'
  /** otlp-http + a loopback endpoint the extension can host a receiver on. */
  | 'loopback';

export interface CopilotOtelConfig {
  kind: CopilotOtelConfigKind;
  endpoint?: string;
  /** Loopback host/port parsed from the endpoint (only for kind 'loopback'). */
  host?: string;
  port?: number;
  /** True when the `enabled` value is policy-forced (managed). */
  managed: boolean;
  /**
   * True when captureContent resolved to true. Content capture would put
   * prompts/code/tool payloads into the exported spans; the extension's
   * allowlist drops them regardless, but the UX still warns.
   */
  contentCaptureEnabled: boolean;
  message: string;
  docsUrl: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface ParsedEndpoint {
  host: string;
  port?: number;
  loopback: boolean;
}

export function parseEndpoint(endpoint: string | undefined): ParsedEndpoint | undefined {
  if (!endpoint) return undefined;
  try {
    const url = new URL(endpoint);
    const host = url.hostname;
    const port = url.port ? Number(url.port) : undefined;
    return { host, port, loopback: LOOPBACK_HOSTS.has(host) };
  } catch {
    return undefined;
  }
}

function make(kind: CopilotOtelConfigKind, probe: CopilotOtelProbe, message: string, extra?: Partial<CopilotOtelConfig>): CopilotOtelConfig {
  return {
    kind,
    managed: probe.enabledByPolicy !== undefined,
    contentCaptureEnabled: probe.captureContent === true,
    endpoint: probe.otlpEndpoint,
    message,
    docsUrl: DOCS_URL,
    ...extra
  };
}

/** Classify resolved Copilot OTel configuration. Fabricates no defaults. */
export function classifyCopilotOtel(probe: CopilotOtelProbe): CopilotOtelConfig {
  if (probe.enabledByPolicy === false) {
    return make('managed-disabled', probe, 'Copilot OpenTelemetry is turned off by an administrator policy; per-call enrichment is unavailable and the extension will not override it.');
  }
  if (probe.enabled !== true) {
    return make('disabled', probe, 'Copilot OpenTelemetry is off. Enable the opt-in otlp-http exporter pointed at a loopback endpoint to add per-call context; the extension never changes this setting for you.');
  }
  if (probe.exporterType !== REQUIRED_EXPORTER_TYPE) {
    const current = probe.exporterType ? `"${probe.exporterType}"` : 'unset';
    return make('wrong-exporter', probe, `Copilot OpenTelemetry is on, but the exporter is ${current}. This integration reads the "otlp-http" exporter.`);
  }
  const parsed = parseEndpoint(probe.otlpEndpoint);
  if (!parsed) {
    return make('endpoint-missing', probe, 'The Copilot otlp-http exporter is selected but github.copilot.chat.otel.otlpEndpoint is not a usable URL.');
  }
  if (!parsed.loopback) {
    return make('endpoint-elsewhere', probe, `Copilot OpenTelemetry is exporting to ${parsed.host}, not a loopback endpoint. The extension leaves that configuration untouched and does not enrich from it.`);
  }
  return make('loopback', probe, 'Copilot OpenTelemetry is exporting to a loopback endpoint the extension can receive on.', {
    host: parsed.host,
    port: parsed.port
  });
}
