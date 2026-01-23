import { persistentAtom } from '@nanostores/persistent';

import { apiFetch } from '$lib/api/fetch';

export type StatePayload = any;

type CachedState = {
  fetchedAtMs: number;
  data: StatePayload;
};

export const stateStore = persistentAtom<CachedState | null>('cc_state_v1', null, {
  encode: JSON.stringify,
  decode: (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  },
});

const DEFAULT_TTL_MS = 5_000;

export async function loadState(opts?: { force?: boolean; ttlMs?: number }) {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;

  const cur = stateStore.get();
  const now = Date.now();

  if (!opts?.force && cur && now - cur.fetchedAtMs < ttlMs) {
    return cur.data;
  }

  const data = await apiFetch<StatePayload>('/state.json');
  stateStore.set({ fetchedAtMs: now, data });
  return data;
}
