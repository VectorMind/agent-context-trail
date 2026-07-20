import * as fs from 'fs';
import * as vscode from 'vscode';
import { classifyCopilotOtel, CopilotOtelProbe, CopilotOtelStatus } from './config';

/**
 * Extension-host adapter for Copilot OTel configuration detection (plan
 * Phase 2). Reads the *resolved* `github.copilot.chat.otel.*` settings and
 * probes the configured outfile, then defers every classification decision to
 * the pure `classifyCopilotOtel`. This module only reads — it never writes a
 * `github.copilot.*` setting (plan goal #3).
 *
 * It is kept `vscode`-dependent and therefore out of the unit test bundle (the
 * test runner externalizes `vscode`); all branching logic lives in
 * `config.ts`, which is fully tested.
 */

const SECTION = 'github.copilot.chat.otel';

/**
 * Read the policy-forced value of a setting when VS Code exposes one. Newer
 * VS Code adds `policyValue` to `inspect()`; the `@types/vscode` baseline this
 * extension compiles against does not declare it yet, so read it defensively
 * through `unknown` rather than assume the API shape (OP-005).
 */
function policyValue<T>(inspected: unknown): T | undefined {
  if (inspected && typeof inspected === 'object' && 'policyValue' in inspected) {
    return (inspected as { policyValue?: T }).policyValue;
  }
  return undefined;
}

function probeOutfile(outfile: string | undefined): Pick<CopilotOtelProbe, 'fileExists' | 'fileReadable' | 'fileSizeBytes'> {
  if (!outfile) return {};
  try {
    const stat = fs.statSync(outfile);
    return { fileExists: true, fileReadable: true, fileSizeBytes: stat.size };
  } catch {
    // Missing or unreadable — the classifier reports the honest state.
    return { fileExists: false };
  }
}

export function detectCopilotOtel(): CopilotOtelStatus {
  const config = vscode.workspace.getConfiguration(SECTION);
  const enabledInspect = config.inspect<boolean>('enabled');

  const outfile = config.get<string>('outfile') || undefined;
  const probe: CopilotOtelProbe = {
    enabled: config.get<boolean>('enabled'),
    enabledByPolicy: policyValue(enabledInspect),
    exporterType: config.get<string>('exporterType') || undefined,
    outfile,
    captureContent: config.get<boolean>('captureContent'),
    ...probeOutfile(outfile)
  };

  return classifyCopilotOtel(probe);
}
