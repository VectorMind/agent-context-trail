// Copilot OTel fixture-capture receiver (plans/2026-07/20/copilot-otel Phase 1).
//
// Loopback-only OTLP/HTTP listener whose ONLY job is to capture real examples
// of what Copilot Chat actually exports, so the production receiver/normalizer
// and the correlation proof can be built against observed bytes rather than
// guessed schema. It intentionally saves the RAW request body (this is the
// fixture-capture step, not the production data plane, which will allowlist and
// discard raw payloads). captureContent is false in the user's settings, so no
// prompt/code/tool content is expected — but we still store under .tmp/ only.
//
// Run:  node scripts/otel-capture.js
// Point Copilot at:  http://127.0.0.1:9876
// Stop:  Ctrl-C (or the harness stops the background task).

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const HOST = '127.0.0.1';
const PORT = Number(process.env.OTEL_CAPTURE_PORT || 9876);
const OUT_DIR = path.join(__dirname, '..', '.tmp', 'copilot-otel-capture');

fs.mkdirSync(OUT_DIR, { recursive: true });

let seq = 0;

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeExt(contentType) {
  if (!contentType) return 'bin';
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('protobuf') || contentType.includes('x-protobuf')) return 'pb';
  return 'bin';
}

function tryDecode(buf, headers) {
  let body = buf;
  const encoding = (headers['content-encoding'] || '').toLowerCase();
  let decompressed = false;
  try {
    if (encoding.includes('gzip')) {
      body = zlib.gunzipSync(buf);
      decompressed = true;
    } else if (encoding.includes('deflate')) {
      body = zlib.inflateSync(buf);
      decompressed = true;
    }
  } catch (err) {
    return { body: buf, decompressed: false, note: `decompress failed: ${err.message}` };
  }
  return { body, decompressed };
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const n = ++seq;
    const base = `${stamp()}_${String(n).padStart(4, '0')}`;
    const ct = req.headers['content-type'] || '';

    // Always record the exact request envelope: method, path, headers, sizes.
    const meta = {
      seq: n,
      receivedAt: new Date().toISOString(),
      method: req.method,
      url: req.url,
      httpVersion: req.httpVersion,
      headers: req.headers,
      rawBytes: raw.length
    };

    // Save raw body exactly as received (compressed if it was compressed).
    const rawExt = safeExt(ct);
    fs.writeFileSync(path.join(OUT_DIR, `${base}.raw.${rawExt}`), raw);

    // Best-effort decoded view for immediate human inspection.
    const { body, decompressed, note } = tryDecode(raw, req.headers);
    meta.contentEncoding = req.headers['content-encoding'] || null;
    meta.decompressed = decompressed;
    if (note) meta.decodeNote = note;
    meta.decodedBytes = body.length;

    if (ct.includes('json')) {
      try {
        const parsed = JSON.parse(body.toString('utf8'));
        fs.writeFileSync(path.join(OUT_DIR, `${base}.decoded.json`), JSON.stringify(parsed, null, 2));
        meta.jsonParsed = true;
      } catch (err) {
        fs.writeFileSync(path.join(OUT_DIR, `${base}.decoded.txt`), body);
        meta.jsonParsed = false;
        meta.jsonError = err.message;
      }
    } else if (decompressed) {
      // Protobuf or unknown: keep the decompressed bytes for later decoding.
      fs.writeFileSync(path.join(OUT_DIR, `${base}.decoded.${safeExt(ct)}`), body);
    }

    fs.writeFileSync(path.join(OUT_DIR, `${base}.meta.json`), JSON.stringify(meta, null, 2));

    const summary =
      `#${n} ${req.method} ${req.url} ct=${ct || '(none)'} enc=${meta.contentEncoding || 'none'} ` +
      `raw=${raw.length}B decoded=${body.length}B${meta.jsonParsed === true ? ' json✓' : ''}`;
    process.stdout.write(summary + '\n');

    // Reply with an OTLP-friendly success so Copilot does not retry endlessly.
    if (ct.includes('json')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    } else if (ct.includes('protobuf')) {
      // An empty body is a valid, empty ExportTraceServiceResponse.
      res.writeHead(200, { 'Content-Type': 'application/x-protobuf' });
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    }
  });
  req.on('error', (err) => {
    process.stdout.write(`request error: ${err.message}\n`);
    try {
      res.writeHead(400);
      res.end();
    } catch {
      /* already closed */
    }
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(`[otel-capture] port ${PORT} is already in use — is a receiver already running?\n`);
  } else {
    process.stderr.write(`[otel-capture] server error: ${err.message}\n`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`[otel-capture] listening on http://${HOST}:${PORT}\n`);
  process.stdout.write(`[otel-capture] point Copilot's otlpEndpoint here; captures -> ${OUT_DIR}\n`);
  process.stdout.write(`[otel-capture] waiting for spans... (start a Copilot chat)\n`);
});
