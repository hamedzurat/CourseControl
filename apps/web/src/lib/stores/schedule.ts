import { atom } from 'nanostores';

import { apiFetch } from '$lib/api';

export type SectionMeta = {
  id: number;
  timeslot: number;
  maxSeats: number;
  location?: string;
  instructorUserId?: string;
};

export type SubjectMeta = {
  id: number;
  code: string;
  name: string;
  sections: SectionMeta[];
};

export const scheduleStore = atom<SubjectMeta[]>([]);
export const scheduleLoading = atom(false);

let loaded = false;

export async function ensureSchedule() {
  if (loaded) return;
  scheduleLoading.set(true);
  try {
    const res = await apiFetch<{ subjects: SubjectMeta[] }>('/actor/everything/schedule');
    scheduleStore.set(res.subjects);
    loaded = true;
  } catch (e) {
    console.error('Failed to load schedule', e);
  } finally {
    scheduleLoading.set(false);
  }
}
