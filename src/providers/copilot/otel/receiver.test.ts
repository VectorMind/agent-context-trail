import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { CopilotOtelReceiver, ingestTraceExport } from './receiver';
import { readAllCalls } from './storage';
import fixture from './fixtures/real-trace-redacted.json';

function tmpBase(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'act-otel-recv-'));
}

function post(port: number, urlPath: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

test('ingestTraceExport persists chat calls and ignores junk', () => {
  const base = tmpBase();
  const stored = ingestTraceExport(base, JSON.stringify(fixture));
  assert.equal(stored, 3);
  assert.equal(readAllCalls(base).length, 3);
  assert.equal(ingestTraceExport(base, 'not json'), 0);
});

test('receiver ingests /v1/traces, ignores /v1/metrics, over loopback', async () => {
  const base = tmpBase();
  const receiver = new CopilotOtelReceiver({ port: 0, baseDir: base });
  const port = await receiver.start();
  try {
    const traces = await post(port, '/v1/traces', JSON.stringify(fixture));
    assert.equal(traces.status, 200);
    assert.equal(traces.body, '{}');

    const metrics = await post(port, '/v1/metrics', JSON.stringify({ resourceMetrics: [] }));
    assert.equal(metrics.status, 200);

    // Only the 3 chat spans from /v1/traces were persisted; metrics stored nothing.
    assert.equal(readAllCalls(base).length, 3);
  } finally {
    await receiver.stop();
  }
});

test('receiver start rejects when the port is already in use', async () => {
  const base = tmpBase();
  const first = new CopilotOtelReceiver({ port: 0, baseDir: base });
  const port = await first.start();
  const second = new CopilotOtelReceiver({ port, baseDir: base });
  try {
    await assert.rejects(second.start(), /EADDRINUSE|address already in use/i);
  } finally {
    await first.stop();
    await second.stop();
  }
});
