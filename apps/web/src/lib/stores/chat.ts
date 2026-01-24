import { persistentAtom } from '@nanostores/persistent';
import { atom, computed } from 'nanostores';

export type ChatMsg = {
  id: string;
  atMs: number;
  dir: 'in' | 'out';
  peerUserId: string;
  text: string;
};

type ChatState = {
  byPeer: Record<string, ChatMsg[]>;
  lastAtByPeer: Record<string, number>;
};

export const chatState = atom<ChatState>({ byPeer: {}, lastAtByPeer: {} });
export const chatActivePeerId = persistentAtom<string>('cc_chat_active_peer', '');

export const chatPeersSorted = computed(chatState, (s) => {
  const peers = Object.keys(s.lastAtByPeer);
  peers.sort((a, b) => (s.lastAtByPeer[b] ?? 0) - (s.lastAtByPeer[a] ?? 0));
  return peers;
});

export const chatActiveMessages = computed([chatState, chatActivePeerId], (s, peerId) =>
  peerId ? (s.byPeer[peerId] ?? []) : [],
);

function push(peer: string, msg: ChatMsg) {
  const s = chatState.get();
  const prev = s.byPeer[peer] ?? [];
  const next = [...prev, msg].slice(-80);

  chatState.set({
    byPeer: { ...s.byPeer, [peer]: next },
    lastAtByPeer: { ...s.lastAtByPeer, [peer]: msg.atMs },
  });
}

export function chatOpen(peerUserId: string) {
  const id = peerUserId.trim();
  if (!id) return;
  chatActivePeerId.set(id);
  const s = chatState.get();
  if (!s.byPeer[id]) {
    chatState.set({
      byPeer: { ...s.byPeer, [id]: [] },
      lastAtByPeer: { ...s.lastAtByPeer, [id]: s.lastAtByPeer[id] ?? 0 },
    });
  }
}

export function chatAddOut(peerUserId: string, text: string, atMs = Date.now()) {
  push(peerUserId, {
    id: crypto.randomUUID(),
    atMs,
    dir: 'out',
    peerUserId,
    text,
  });
}

export function chatOnServerMessage(msg: any, myUserId: string) {
  // expected: { type:"chat", nowMs, fromUserId, toUserId, text }
  const from = String(msg?.fromUserId ?? '');
  const to = String(msg?.toUserId ?? '');
  const text = String(msg?.text ?? '');
  const atMs = Number(msg?.nowMs ?? Date.now());
  if (!from || !to || !text) return;

  const peer = from === myUserId ? to : from;
  if (from === myUserId) return; // ignore my own echo (optimistic UI)
  const dir: 'in' | 'out' = 'in';

  push(peer, {
    id: crypto.randomUUID(),
    atMs,
    dir,
    peerUserId: peer,
    text,
  });
}
