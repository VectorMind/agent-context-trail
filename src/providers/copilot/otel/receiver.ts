import * as http from 'http';
import { normalizeTraceExport } from './normalize';
import { appendCalls } from './storage';

/**
 * Loopback OTLP/HTTP receiver (plan_v2 Phase 3). Copilot Chat, when the user
 * points its `otlpEndpoint` here, POSTs OTLP/JSON to `/v1/traces` (plus
 * `/v1/logs` and `/v1/metrics`, which we accept and ignore). For traces we
 * parse, normalize to the allowlist, append the normalized records, and
 * DISCARD the raw body immediately — the raw request and every content/repo
 * attribute never touch disk. Binds `127.0.0.1` only; not a general network
 * service. The extension owns start/stop with its lifecycle.
 */

const DEFAULT_HOST = '127.0.0.1';
// Observed real trace payloads reach ~390 KB; cap generously and reject abuse.
const MAX_BODY_BYTES = 64 * 1024 * 1024;

export interface OtelReceiverOptions {
  port: number;
  /** Extension storage base dir; normalized JSONL lives under it. */
  baseDir: string;
  host?: string;
  /** Reports ingest counts and errors (to the extension output channel). */
  log?: (message: string) => void;
  /** Called after a successful trace ingest, e.g. to trigger a panel refresh. */
  onIngest?: (storedCalls: number) => void;
}

/**
 * Parse+normalize+persist one OTLP trace export body, discarding the raw input.
 * Pure enough to unit test without a socket. Returns the number of persisted
 * (chat) call records.
 */
export function ingestTraceExport(baseDir: string, rawBody: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return 0; // defensive: ignore non-JSON bodies rather than throw
  }
  const calls = normalizeTraceExport(parsed);
  if (calls.length > 0) appendCalls(baseDir, calls);
  return calls.length;
}

export class CopilotOtelReceiver {
  private server: http.Server | undefined;
  private boundPort: number | undefined;

  constructor(private readonly options: OtelReceiverOptions) {}

  get port(): number | undefined {
    return this.boundPort;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const host = this.options.host ?? DEFAULT_HOST;
      const server = http.createServer((req, res) => this.handle(req, res));
      server.on('error', (err) => {
        // EADDRINUSE etc. — surfaces as a receiver-inactive state upstream.
        reject(err);
      });
      server.listen(this.options.port, host, () => {
        const addr = server.address();
        this.boundPort = typeof addr === 'object' && addr ? addr.port : this.options.port;
        this.server = server;
        this.options.log?.(`[copilot-otel] receiver listening on http://${host}:${this.boundPort}`);
        resolve(this.boundPort);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => {
        this.server = undefined;
        this.boundPort = undefined;
        resolve();
      });
    });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    const url = req.url ?? '';
    const isTraces = url.endsWith('/v1/traces');
    // We accept logs/metrics so Copilot's exporter does not retry-loop, but we
    // never read or store them.
    const isKnownIgnored = url.endsWith('/v1/logs') || url.endsWith('/v1/metrics');

    let size = 0;
    const chunks: Buffer[] = [];
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      if (isTraces) chunks.push(chunk); // only buffer what we will parse
    });
    req.on('end', () => {
      if (aborted) return;
      if (isTraces) {
        try {
          const stored = ingestTraceExport(this.options.baseDir, Buffer.concat(chunks).toString('utf8'));
          if (stored > 0) {
            this.options.log?.(`[copilot-otel] ingested ${stored} call record(s)`);
            this.options.onIngest?.(stored);
          }
        } catch (err) {
          this.options.log?.(`[copilot-otel] ingest failed: ${(err as Error).message}`);
        }
      }
      // OTLP-friendly success for traces and ignored signals alike.
      if (isTraces || isKnownIgnored) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
      } else {
        res.writeHead(404).end();
      }
    });
    req.on('error', () => {
      if (!res.headersSent) res.writeHead(400).end();
    });
  }
}
