import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCopilotOtel, CopilotOtelProbe, parseEndpoint } from './config';

const loopback: CopilotOtelProbe = {
  enabled: true,
  exporterType: 'otlp-http',
  otlpEndpoint: 'http://127.0.0.1:9876',
  captureContent: false
};

test('unset configuration classifies as disabled', () => {
  const c = classifyCopilotOtel({});
  assert.equal(c.kind, 'disabled');
  assert.equal(c.managed, false);
});

test('policy-forced off takes precedence over an on user value', () => {
  const c = classifyCopilotOtel({ ...loopback, enabledByPolicy: false });
  assert.equal(c.kind, 'managed-disabled');
});

test('a non-otlp-http exporter classifies as wrong-exporter and names it', () => {
  const c = classifyCopilotOtel({ enabled: true, exporterType: 'file' });
  assert.equal(c.kind, 'wrong-exporter');
  assert.match(c.message, /"file"/);
});

test('otlp-http without an endpoint classifies as endpoint-missing', () => {
  const c = classifyCopilotOtel({ enabled: true, exporterType: 'otlp-http' });
  assert.equal(c.kind, 'endpoint-missing');
});

test('a non-loopback endpoint classifies as endpoint-elsewhere and is left untouched', () => {
  const c = classifyCopilotOtel({ ...loopback, otlpEndpoint: 'http://collector.corp:4318' });
  assert.equal(c.kind, 'endpoint-elsewhere');
  assert.match(c.message, /collector\.corp/);
});

test('a loopback endpoint classifies as loopback and parses host/port', () => {
  const c = classifyCopilotOtel(loopback);
  assert.equal(c.kind, 'loopback');
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.port, 9876);
});

test('localhost is treated as loopback too', () => {
  const c = classifyCopilotOtel({ ...loopback, otlpEndpoint: 'http://localhost:4318' });
  assert.equal(c.kind, 'loopback');
  assert.equal(c.port, 4318);
});

test('content capture is surfaced (privacy warning) and policy presence sets managed', () => {
  assert.equal(classifyCopilotOtel(loopback).contentCaptureEnabled, false);
  assert.equal(classifyCopilotOtel({ ...loopback, captureContent: true }).contentCaptureEnabled, true);
  assert.equal(classifyCopilotOtel({ ...loopback, enabledByPolicy: true }).managed, true);
});

test('parseEndpoint rejects junk and flags loopback correctly', () => {
  assert.equal(parseEndpoint('not a url'), undefined);
  assert.equal(parseEndpoint(undefined), undefined);
  assert.equal(parseEndpoint('http://127.0.0.1:9876')?.loopback, true);
  assert.equal(parseEndpoint('http://example.com:80')?.loopback, false);
});
