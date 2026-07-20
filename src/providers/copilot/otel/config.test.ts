import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCopilotOtel, CopilotOtelProbe } from './config';

const usable: CopilotOtelProbe = {
  enabled: true,
  exporterType: 'file',
  outfile: 'C:\\trace\\copilot-otel.jsonl',
  captureContent: false,
  fileExists: true,
  fileReadable: true,
  fileSizeBytes: 4096
};

test('unset configuration classifies as disabled', () => {
  const status = classifyCopilotOtel({});
  assert.equal(status.kind, 'disabled');
  assert.equal(status.ready, false);
});

test('enabled:false classifies as disabled, not managed', () => {
  const status = classifyCopilotOtel({ enabled: false });
  assert.equal(status.kind, 'disabled');
});

test('policy-forced off takes precedence over an on user value', () => {
  const status = classifyCopilotOtel({ ...usable, enabledByPolicy: false });
  assert.equal(status.kind, 'managed-disabled');
  assert.equal(status.ready, false);
});

test('enabled with a non-file exporter classifies as wrong-exporter and names it', () => {
  const status = classifyCopilotOtel({ enabled: true, exporterType: 'otlp' });
  assert.equal(status.kind, 'wrong-exporter');
  assert.match(status.message, /"otlp"/);
});

test('enabled with an unset exporter is wrong-exporter (no fabricated default)', () => {
  const status = classifyCopilotOtel({ enabled: true });
  assert.equal(status.kind, 'wrong-exporter');
  assert.match(status.message, /unset/);
});

test('file exporter without an outfile classifies as missing-outfile', () => {
  const status = classifyCopilotOtel({ enabled: true, exporterType: 'file' });
  assert.equal(status.kind, 'missing-outfile');
});

test('a configured outfile that does not exist classifies as unreadable', () => {
  const status = classifyCopilotOtel({ ...usable, fileExists: false });
  assert.equal(status.kind, 'unreadable');
  assert.match(status.message, /copilot-otel\.jsonl/);
});

test('a configured outfile that cannot be read classifies as unreadable', () => {
  const status = classifyCopilotOtel({ ...usable, fileReadable: false });
  assert.equal(status.kind, 'unreadable');
});

test('an existing empty outfile classifies as empty', () => {
  const status = classifyCopilotOtel({ ...usable, fileSizeBytes: 0 });
  assert.equal(status.kind, 'empty');
});

test('a readable non-empty file exporter classifies as usable and ready', () => {
  const status = classifyCopilotOtel(usable);
  assert.equal(status.kind, 'usable');
  assert.equal(status.ready, true);
  assert.equal(status.outfile, usable.outfile);
  assert.equal(status.fileSizeBytes, 4096);
});

test('content capture is surfaced even on a usable state (privacy warning)', () => {
  assert.equal(classifyCopilotOtel(usable).contentCaptureEnabled, false);
  assert.equal(classifyCopilotOtel({ ...usable, captureContent: true }).contentCaptureEnabled, true);
});
