import type { DurableObjectState } from '@cloudflare/workers-types';

import type { ServerToClient } from './protocol';

/**
 * Workers vs DOM WebSocket typing is a mess in TS because both exist.
 * We keep the type loose and only rely on ws.send / ws.close.
 */
export type AnyWebSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export function upgradeToWebSocket(state: DurableObjectState): { response: Response; server: AnyWebSocket } {
  // WebSocketPair exists in Workers runtime, but TS may not like it
  const pair = new (globalThis as any).WebSocketPair();
  const client = pair[0];
  const server = pair[1];

  // Hibernation API
  state.acceptWebSocket(server);

  return {
    response: new Response(null, { status: 101, webSocket: client }),
    server,
  };
}

export function sendJson(ws: AnyWebSocket, msg: ServerToClient) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // ignore
  }
}

export function broadcast(state: DurableObjectState, msg: ServerToClient) {
  // state.getWebSockets() returns Worker WebSockets; treat them as AnyWebSocket
  const sockets = state.getWebSockets() as unknown as AnyWebSocket[];
  for (const ws of sockets) sendJson(ws, msg);
}

export function parseJsonMessage(message: unknown): any | null {
  let text: string | null = null;

  if (typeof message === 'string') {
    text = message;
  } else if (message instanceof ArrayBuffer) {
    text = new TextDecoder().decode(new Uint8Array(message));
  } else if (ArrayBuffer.isView(message)) {
    text = new TextDecoder().decode(message as ArrayBufferView);
  } else {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
