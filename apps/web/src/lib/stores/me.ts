import { atom } from 'nanostores';

import { apiFetch } from '$lib/api/fetch';

export type MePayload = {
  user: { id: string; email: string; role: 'student' | 'faculty' | 'admin' };
  profile: any | null;
  enrollments: any[];
  selections: any[];
  groups: any[];
  swaps: any[];
};

export const meStore = atom<MePayload | null>(null);

export async function loadMe() {
  const me = await apiFetch<MePayload>('/me');
  meStore.set(me);
  return me;
}

export function clearMe() {
  meStore.set(null);
}
