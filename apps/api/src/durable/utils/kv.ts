import type { Env } from '../../env';

export async function getSubjectKv(env: Env, subjectId: number | string): Promise<any | null> {
  const key = `subject:${subjectId}`;
  const txt = await env.KV_SUBJECT.get(key);
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}
