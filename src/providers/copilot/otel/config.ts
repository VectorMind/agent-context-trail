/**
 * Copilot OTel enrichment — configuration detection (plan Phase 2).
 *
 * Copilot Chat can emit one `chat` span per LLM call through a supported,
 * opt-in OpenTelemetry file exporter. This module classifies the *resolved*
 * Copilot OTel configuration into one honest state so the rest of the feature
 * (and the UX) can either enrich from the file or explain, without ever
 * writing a `github.copilot.*` setting on the user's behalf (plan goal #3).
 *
 * This file is intentionally free of any `vscode` / `fs` import so it stays a
 * pure, fully unit-tested classifier. The extension-host adapter in
 * `detect.ts` reads the resolved settings and probes the outfile, then hands
 * the raw facts here.
 *
 * Settings, per the source contract in plan.md:
 *   github.copilot.chat.otel.enabled        (boolean)
 *   github.copilot.chat.otel.exporterType   ("file" for this integration)
 *   github.copilot.chat.otel.outfile        (path)
 *   github.copilot.chat.otel.captureContent (must stay false — privacy)
 */

const DOCS_URL = 'https://code.visualstudio.com/docs/agents/guides/monitoring-agents';
const SETTINGS_DOCS_URL =
  'https://code.visualstudio.com/docs/agents/reference/ai-settings#_observability-settings';

/** The exporter type this integration consumes. */
export const REQUIRED_EXPORTER_TYPE = 'file';

/**
 * Raw resolved configuration plus an outfile filesystem probe. Every field is
 * optional so the adapter can pass whatever VS Code actually resolved; absent
 * means "not set", never a fabricated default.
 */
export interface CopilotOtelProbe {
  /** Effective resolved value of `...otel.enabled`. */
  enabled?: boolean;
  /**
   * Policy-forced value of `...otel.enabled` when VS Code exposes one via
   * `inspect().policyValue`. Enterprise policy takes precedence over user and
   * workspace settings (plan "Enterprise Constraints"). Best-effort: OP-005
   * tracks whether resolved settings reliably distinguish policy-off from an
   * ordinary user-off, so we only claim "managed" when a policy value is
   * actually present and false.
   */
  enabledByPolicy?: boolean;
  /** Effective resolved value of `...otel.exporterType`. */
  exporterType?: string;
  /** Effective resolved value of `...otel.outfile`. */
  outfile?: string;
  /** Effective resolved value of `...otel.captureContent`. */
  captureContent?: boolean;
  /** Outfile probe results, filled by the host adapter. */
  fileExists?: boolean;
  /** False when the outfile exists but could not be stat/opened. */
  fileReadable?: boolean;
  fileSizeBytes?: number;
}

export type CopilotOtelStatusKind =
  /** `...otel.enabled` is not true and no policy forces it off. */
  | 'disabled'
  /** Enterprise policy forces OTel off; an honest admin-owned state, not an error. */
  | 'managed-disabled'
  /** Enabled, but the exporter is not the `file` exporter this integration reads. */
  | 'wrong-exporter'
  /** File exporter selected, but no `outfile` path is configured. */
  | 'missing-outfile'
  /** Outfile configured, but the file does not exist or cannot be read. */
  | 'unreadable'
  /** Outfile exists and is readable, but empty (no spans exported yet). */
  | 'empty'
  /** File exporter with a readable, non-empty outfile — enrichment can proceed. */
  | 'usable';

export interface CopilotOtelStatus {
  kind: CopilotOtelStatusKind;
  /** True only for `usable`: the outfile is worth reading. */
  ready: boolean;
  /** Absolute outfile path when one is configured, for UX and the reader. */
  outfile?: string;
  fileSizeBytes?: number;
  /**
   * True when `...otel.captureContent` resolved to true. This integration only
   * needs metadata; content capture would persist prompts/code/tool payloads
   * into the outfile, so the UX must warn even when the state is otherwise
   * usable (plan goal #4).
   */
  contentCaptureEnabled: boolean;
  /** One-line, user-facing explanation of the state. */
  message: string;
  /** Doc link the UX can offer; never an automatic enable action. */
  docsUrl: string;
}

function base(kind: CopilotOtelStatusKind, probe: CopilotOtelProbe, message: string): CopilotOtelStatus {
  return {
    kind,
    ready: kind === 'usable',
    outfile: probe.outfile,
    fileSizeBytes: probe.fileSizeBytes,
    contentCaptureEnabled: probe.captureContent === true,
    message,
    docsUrl: kind === 'wrong-exporter' || kind === 'missing-outfile' ? SETTINGS_DOCS_URL : DOCS_URL
  };
}

/**
 * Classify the resolved Copilot OTel configuration into one honest state.
 * Never fabricates a default: an unset `enabled` is treated as off, an unset
 * `exporterType` is treated as "not the file exporter" (the integration
 * requires an explicit `file` selection, per the source contract).
 */
export function classifyCopilotOtel(probe: CopilotOtelProbe): CopilotOtelStatus {
  // Enterprise policy precedence first (plan "Enterprise Constraints").
  if (probe.enabledByPolicy === false) {
    return base(
      'managed-disabled',
      probe,
      'Copilot OpenTelemetry is turned off by an administrator policy. Per-call context enrichment is unavailable and the extension will not override the policy.'
    );
  }

  if (probe.enabled !== true) {
    return base(
      'disabled',
      probe,
      'Copilot OpenTelemetry is off. Enable the opt-in file exporter to add per-call context to the Copilot timeline; the extension never changes this setting for you.'
    );
  }

  if (probe.exporterType !== REQUIRED_EXPORTER_TYPE) {
    const current = probe.exporterType ? `"${probe.exporterType}"` : 'unset';
    return base(
      'wrong-exporter',
      probe,
      `Copilot OpenTelemetry is on, but the exporter is ${current}. This integration reads the "file" exporter; set github.copilot.chat.otel.exporterType to "file".`
    );
  }

  if (!probe.outfile) {
    return base(
      'missing-outfile',
      probe,
      'The Copilot OpenTelemetry file exporter is selected but github.copilot.chat.otel.outfile is not set. Choose a file path to export spans to.'
    );
  }

  if (probe.fileExists !== true || probe.fileReadable === false) {
    return base(
      'unreadable',
      probe,
      `The configured Copilot OpenTelemetry outfile could not be read (${probe.outfile}). It may not exist yet — start a Copilot chat with the exporter enabled to create it.`
    );
  }

  if ((probe.fileSizeBytes ?? 0) <= 0) {
    return base(
      'empty',
      probe,
      'The Copilot OpenTelemetry outfile exists but is empty. No spans have been exported yet; run a Copilot chat request to populate it.'
    );
  }

  return base(
    'usable',
    probe,
    'Copilot OpenTelemetry file export is available for per-call context enrichment.'
  );
}
