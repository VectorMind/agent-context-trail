import * as vscode from 'vscode';
import { classifyCopilotOtel, CopilotOtelConfig, CopilotOtelProbe } from './config';

/**
 * Extension-host adapter for Copilot OTel configuration detection (plan_v2
 * Phase 2). Reads the *resolved* `github.copilot.chat.otel.*` settings and
 * defers classification to the pure `classifyCopilotOtel`. Read-only — it never
 * writes a `github.copilot.*` setting. Kept out of the unit bundle because the
 * test runner externalizes `vscode`.
 */

const SECTION = 'github.copilot.chat.otel';

/** Read policyValue defensively; `@types/vscode` baseline does not declare it (OP-005). */
function policyValue<T>(inspected: unknown): T | undefined {
  if (inspected && typeof inspected === 'object' && 'policyValue' in inspected) {
    return (inspected as { policyValue?: T }).policyValue;
  }
  return undefined;
}

export function detectCopilotOtel(): CopilotOtelConfig {
  const config = vscode.workspace.getConfiguration(SECTION);
  const probe: CopilotOtelProbe = {
    enabled: config.get<boolean>('enabled'),
    enabledByPolicy: policyValue(config.inspect<boolean>('enabled')),
    exporterType: config.get<string>('exporterType') || undefined,
    otlpEndpoint: config.get<string>('otlpEndpoint') || undefined,
    captureContent: config.get<boolean>('captureContent')
  };
  return classifyCopilotOtel(probe);
}
