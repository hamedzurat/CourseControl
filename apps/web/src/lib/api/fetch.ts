import { API_BASE } from '$lib/config';
import { authStore } from '$lib/stores/auth';

async function readJson(resp: Response) {
  const text = await resp.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = authStore.get();

  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');

  const hasBody = typeof init.body === 'string' || init.body instanceof FormData;
  if (hasBody && !headers.has('content-type') && !(init.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }

  if (auth?.token) headers.set('authorization', `Bearer ${auth.token}`);

  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  const data = await readJson(resp);

  if (!resp.ok) {
    const msg = (data?.message ?? data?.error ?? `Request failed (${resp.status})`) as string;
    throw new Error(msg);
  }

  return data as T;
}
