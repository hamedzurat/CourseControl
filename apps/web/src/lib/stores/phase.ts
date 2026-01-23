import { persistentAtom } from '@nanostores/persistent';

import { apiFetch } from '$lib/api/fetch';

export type PhasePayload = {
  nowMs: number;
  phase: 'pre' | 'selection' | 'between' | 'swap' | 'post';
  schedule: null | {
    selectionStartMs: number;
    selectionEndMs: number;
    swapStartMs: number;
    swapEndMs: number;
    createdAtMs: number;
  };
};

export const phaseStore = persistentAtom<PhasePayload | null>('phase:v1', null, {
  encode: JSON.stringify,
  decode: JSON.parse,
});

export async function loadPhase(force = false) {
  const cur = phaseStore.get();
  if (cur && !force) return cur;
  const data = await apiFetch<PhasePayload>('/phase');
  phaseStore.set(data);
  return data;
}
