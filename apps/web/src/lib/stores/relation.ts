import { persistentAtom } from '@nanostores/persistent';

import { apiFetch } from '$lib/api/fetch';

export type RelationPayload = {
  generatedAtMs: number;
  subjects: Array<{
    id: number;
    code: string;
    name: string;
    type: string;
    credits: number;
    sections: Array<{
      id: number;
      sectionNumber: string;
      faculty: { id: string; name: string | null; email: string | null; image: string | null };
      maxSeats: number;
      timeslotMask: number;
    }>;
  }>;
};

export const relationStore = persistentAtom<RelationPayload | null>('relation:v1', null, {
  encode: JSON.stringify,
  decode: JSON.parse,
});

export async function loadRelation(force = false) {
  const cur = relationStore.get();
  if (cur && !force) return cur;
  const data = await apiFetch<RelationPayload>('/relation.json');
  relationStore.set(data);
  return data;
}
