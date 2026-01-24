import { wsStatus } from '$lib/stores/ws';

type WsHandler = (msg: any) => void;

interface WsOptions {
  url: string;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
  handlers?: WsHandler[];
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;
  private backoffMs = 200;
  private handlers: Set<WsHandler> = new Set();
  private options: WsOptions;

  constructor(options: WsOptions) {
    this.options = options;
    if (options.handlers) {
      options.handlers.forEach((h) => this.handlers.add(h));
    }
  }

  public connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    wsStatus.set({ state: 'connecting' });

    try {
      this.ws = new WebSocket(this.options.url);

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.backoffMs = 200;
        wsStatus.set({ state: 'connected' });
        this.options.onOpen?.();
      };

      this.ws.onclose = () => {
        console.log('[WS] Disconnected');
        this.ws = null;
        wsStatus.set({ state: 'disconnected' });
        this.options.onClose?.();
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Error', err);
        wsStatus.set({ state: 'error', message: 'Connection error' });
        this.options.onError?.();
        try {
          this.ws?.close();
        } catch {}
      };

      this.ws.onmessage = (ev) => {
        let payload: any;
        try {
          payload = JSON.parse(ev.data);
        } catch {
          // ignore non-json
          return;
        }
        // Dispatch to all handlers
        for (const handler of this.handlers) {
          try {
            handler(payload);
          } catch (e) {
            console.error('[WS] Handler error', e);
          }
        }
      };
    } catch (e) {
      console.error('[WS] Setup failed', e);
      this.scheduleReconnect();
    }
  }

  public disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.backoffMs = 200;
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
    wsStatus.set({ state: 'disconnected' });
  }

  public send(data: any): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  public addHandler(h: WsHandler) {
    this.handlers.add(h);
  }

  public removeHandler(h: WsHandler) {
    this.handlers.delete(h);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log(`[WS] Reconnecting in ${this.backoffMs}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(5000, Math.floor(this.backoffMs * 1.5));
      this.connect();
    }, this.backoffMs);
  }
}
