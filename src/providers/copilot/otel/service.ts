import { detectCopilotOtel } from './detect';
import { buildStorageFooterLines, CopilotOtelRuntime } from './footer';
import { CopilotOtelReceiver } from './receiver';
import { runRetention } from './retention';
import { storageBytes } from './storage';

/**
 * Host-side lifecycle owner for Copilot OTel enrichment (plan_v2 Phase 7). Ties
 * together configuration detection, the loopback receiver, retention, the
 * normalized store's base directory, and the panel footer. All branching lives
 * in the pure, tested modules (config/footer/retention/normalize/storage); this
 * class only orchestrates side effects and holds `vscode`-derived state.
 *
 * Activation rule: only starts a receiver when the user has enabled the
 * otlp-http exporter pointed at a loopback endpoint. The extension binds the
 * port the user chose — it never writes Copilot settings or picks a port for
 * them (OP-004: the user owns the endpoint).
 */
export class CopilotOtelService {
  private receiver: CopilotOtelReceiver | undefined;
  private receiverActive = false;
  private storageError = false;

  constructor(
    private readonly baseDir: string,
    private readonly log: (message: string) => void,
    private readonly onIngest: () => void
  ) {}

  /** Directory of the extension's own normalized OTel store. */
  get storageDir(): string {
    return this.baseDir;
  }

  async start(): Promise<void> {
    this.safeRetention();

    const config = detectCopilotOtel();
    if (config.kind !== 'loopback' || !config.port) {
      this.log(`[copilot-otel] ${config.message}`);
      return;
    }
    if (config.contentCaptureEnabled) {
      this.log('[copilot-otel] warning: captureContent is enabled in Copilot; the receiver still drops all content before storing.');
    }

    this.receiver = new CopilotOtelReceiver({
      port: config.port,
      host: config.host,
      baseDir: this.baseDir,
      log: this.log,
      onIngest: () => {
        this.safeRetention();
        this.onIngest();
      }
    });
    try {
      await this.receiver.start();
      this.receiverActive = true;
    } catch (err) {
      this.receiverActive = false;
      this.receiver = undefined;
      this.log(`[copilot-otel] receiver could not bind ${config.host}:${config.port}: ${(err as Error).message}`);
    }
  }

  async stop(): Promise<void> {
    await this.receiver?.stop();
    this.receiver = undefined;
    this.receiverActive = false;
  }

  private safeRetention(): void {
    try {
      runRetention(this.baseDir, new Date(), {}, this.log);
      this.storageError = false;
    } catch (err) {
      this.storageError = true;
      this.log(`[copilot-otel] retention failed: ${(err as Error).message}`);
    }
  }

  private runtime(): CopilotOtelRuntime {
    let bytes = 0;
    try {
      bytes = storageBytes(this.baseDir);
    } catch {
      this.storageError = true;
    }
    return { receiverActive: this.receiverActive, storageBytes: bytes, storageError: this.storageError };
  }

  /** The panel Storage Footer lines for the current state (re-detected each call). */
  footerLines(): string[] {
    return buildStorageFooterLines(detectCopilotOtel(), this.runtime());
  }
}
