import { API_BASE } from '$lib/config';
import { authStore, clearAuth, setAuth, type AuthState } from '$lib/stores/auth';

type ApiError = { error?: string; message?: string };

async function readJsonSafe(resp: Response) {
  const text = await resp.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  opts: { auth?: AuthState | null } = {},
): Promise<T> {
  const auth = opts.auth ?? authStore.get();

  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');

  if (auth?.token) headers.set('authorization', `Bearer ${auth.token}`);

  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  const data = await readJsonSafe(resp);

  if (!resp.ok) {
    const err = (data ?? {}) as ApiError;
    const msg = err.message || err.error || `Request failed (${resp.status})`;
    throw new Error(msg);
  }

  return data as T;
}

// This hits POST /auth/app/token (backend already has it). :contentReference[oaicite:5]{index=5}
export async function mintAppTokenFromSession(): Promise<AuthState> {
  const resp = await fetch(`${API_BASE}/auth/app/token`, {
    method: 'POST',
    // Important: if you rely on cookies, you need credentials.
    credentials: 'include',
    headers: { accept: 'application/json' },
  });

  const data = await readJsonSafe(resp);

  if (!resp.ok) {
    const err = (data ?? {}) as ApiError;
    throw new Error(err.message || err.error || `Failed to mint token (${resp.status})`);
  }

  return data as AuthState;
}

// Helper used by login pages:
export async function refreshAppAuthFromSession() {
  const a = await mintAppTokenFromSession();
  setAuth(a);
  return a;
}

export function logoutLocal() {
  clearAuth();
}
