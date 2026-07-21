import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCopilotOtel, CopilotOtelConfig } from './config';
import { buildStorageFooterLines, copilotOtelFooterLine, CopilotOtelRuntime, formatBytes } from './footer';

const loopback = classifyCopilotOtel({
  enabled: true,
  exporterType: 'otlp-http',
  otlpEndpoint: 'http://127.0.0.1:9876'
});

function rt(over: Partial<CopilotOtelRuntime> = {}): CopilotOtelRuntime {
  return { receiverActive: true, storageBytes: 0, ...over };
}

test('formatBytes is human readable', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(14_889_000), '14.2 MB');
  assert.equal(formatBytes(2 * 1024 * 1024 * 1024), '2.0 GB');
});

test('inactive states map to "inactive"', () => {
  assert.equal(copilotOtelFooterLine(classifyCopilotOtel({}), rt()), 'Copilot detail: inactive');
});

test('managed-disabled notes organization ownership', () => {
  const managed = classifyCopilotOtel({ enabled: true, exporterType: 'otlp-http', otlpEndpoint: 'http://127.0.0.1:1', enabledByPolicy: false });
  assert.equal(copilotOtelFooterLine(managed, rt()), 'Copilot detail: inactive (managed by organization)');
});

test('endpoint-elsewhere is reported without touching it', () => {
  const elsewhere = classifyCopilotOtel({ enabled: true, exporterType: 'otlp-http', otlpEndpoint: 'http://corp:4318' });
  assert.equal(copilotOtelFooterLine(elsewhere, rt()), 'Copilot detail: exporting elsewhere');
});

test('loopback active with data shows the storage size', () => {
  assert.equal(
    copilotOtelFooterLine(loopback, rt({ storageBytes: 14_889_000 })),
    'Copilot detail: active · local usage history 14.2 MB'
  );
});

test('loopback active with no data says so', () => {
  assert.equal(copilotOtelFooterLine(loopback, rt()), 'Copilot detail: active · no compatible spans received');
});

test('loopback but receiver not bound / storage error are honest', () => {
  assert.equal(copilotOtelFooterLine(loopback, rt({ receiverActive: false })), 'Copilot detail: receiver unavailable (port in use)');
  assert.equal(copilotOtelFooterLine(loopback, rt({ storageBytes: 10, storageError: true })), 'Copilot detail: storage unavailable');
});

test('managed loopback activation is distinguished from user activation', () => {
  const managedOn: CopilotOtelConfig = classifyCopilotOtel({
    enabled: true,
    exporterType: 'otlp-http',
    otlpEndpoint: 'http://127.0.0.1:9876',
    enabledByPolicy: true
  });
  assert.equal(
    copilotOtelFooterLine(managedOn, rt({ storageBytes: 1024 })),
    'Copilot detail: managed by organization · local usage history 1.0 KB'
  );
});

test('footer carries only the status line', () => {
  const none = buildStorageFooterLines(loopback, rt());
  assert.deepEqual(none, ['Copilot detail: active · no compatible spans received']);
  const some = buildStorageFooterLines(loopback, rt({ storageBytes: 2048 }));
  assert.deepEqual(some, ['Copilot detail: active · local usage history 2.0 KB']);
});
