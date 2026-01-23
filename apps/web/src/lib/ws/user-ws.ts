import { API_BASE, wsBaseFromHttp } from '$lib/config';
import { authStore } from '$lib/stores/auth';
import { chatOnServerMessage } from '$lib/stores/chat';
import { meStore } from '$lib/stores/me';
import {
  facultyStatus,
  groupInvites,
  seatStatus,
  studentStatus,
  swapInvites,
  userQueue,
  wsLog,
  wsStatus,
} from '$lib/stores/ws';

let ws: WebSocket | null = null;
let reconnectTimer: any = null;
let backoffMs = 200;

function pushLog(entry: any) {
  const cur = wsLog.get();
  const next = [...cur, entry];
  while (next.length > 50) next.shift();
  wsLog.set(next);
}

export function closeUserWs() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;

  backoffMs = 200;
  wsStatus.set({ state: 'disconnected' });

  try {
    ws?.close();
  } catch {}
  ws = null;
}

export function ensureUserWsConnected() {
  const auth = authStore.get();
  if (!auth?.user?.role || !auth?.token) {
    closeUserWs();
    return;
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const base = wsBaseFromHttp(API_BASE);
  const kind = auth.user.role;
  const url = `${base}/actor/${kind}?token=${encodeURIComponent(auth.token)}`;

  wsStatus.set({ state: 'connecting' });

  ws = new WebSocket(url);

  ws.onopen = () => {
    backoffMs = 200;
    wsStatus.set({ state: 'connected' });
  };

  ws.onclose = () => {
    wsStatus.set({ state: 'disconnected' });
    scheduleReconnect();
  };

  ws.onerror = () => {
    wsStatus.set({ state: 'error', message: 'WebSocket error' });
    try {
      ws?.close();
    } catch {}
  };

  // ONE message handler for everything
  ws.onmessage = (ev) => {
    let msg: any = ev.data;
    try {
      msg = JSON.parse(ev.data);
    } catch {}

    pushLog({ at: Date.now(), msg });

    // 1. SEAT STATUS (Global Availability)
    if (msg?.type === 'seat_status') {
      const incoming = msg.subjects || msg;
      const current = seatStatus.get();
      seatStatus.set({ ...current, ...incoming });
    }

    // 2. MAIN STATUS (Student/Faculty Data)
    if (msg?.type === 'status') {
      const incomingData = msg.data ?? {};

      // A. Faculty Logic
      if (incomingData.taughtSectionIds && incomingData.faculty) {
        const prev = facultyStatus.get() ?? {};
        facultyStatus.set({ ...prev, ...incomingData });
      }

      // B. Student Logic
      // If we see student keys, treat as student update
      // B. Student Logic
      // FIX: Added incomingData.groupInvites and swapInvites to the check.
      // Previously, messages containing ONLY invites were being ignored.
      if (
        incomingData.enrolledSubjectIds ||
        incomingData.groups ||
        incomingData.swaps ||
        incomingData.selections ||
        incomingData.queue ||
        incomingData.groupInvites ||
        incomingData.swapInvites
      ) {
        const prev = studentStatus.get() ?? {};
        const prevData = prev.data || {};

        const nextData = {
          ...prevData,
          ...incomingData,
        };

        studentStatus.set({
          ...prev,
          phase: msg.phase ?? prev.phase,
          data: nextData,
        });

        // Sync specialized atoms
        if (incomingData.queue) {
          userQueue.set(incomingData.queue);
        }

        if (Array.isArray(incomingData.groupInvites)) {
          groupInvites.set(incomingData.groupInvites);
        }

        if (Array.isArray(incomingData.swapInvites)) {
          swapInvites.set(incomingData.swapInvites);
        }
      }
    }

    // 3. INCREMENTAL QUEUE UPDATE
    if (msg?.type === 'queue_update') {
      const item = msg.item;
      const currentQ = [...userQueue.get()];
      const idx = currentQ.findIndex((x) => x.id === item.id);

      if (idx >= 0) currentQ[idx] = item;
      else currentQ.push(item);

      userQueue.set(currentQ);
    }

    // 4. CHAT
    if (msg?.type === 'chat') {
      const myId = meStore.get()?.user?.id ?? authStore.get()?.user?.id ?? '';
      if (myId) chatOnServerMessage(msg, myId);
      return;
    }
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    backoffMs = Math.min(1000, Math.floor(backoffMs * 1.6));
    ensureUserWsConnected();
  }, backoffMs);
}

export function userWsSend(obj: any) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(obj));
  return true;
}

export function sendUserAction(action: string, payload?: any) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;

  ws.send(
    JSON.stringify({
      type: 'action',
      id: crypto.randomUUID(),
      action,
      payload,
    }),
  );

  return true;
}
