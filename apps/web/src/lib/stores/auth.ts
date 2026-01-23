import { persistentAtom } from '@nanostores/persistent';

export type Role = 'student' | 'faculty' | 'admin';

export type AuthState = {
  token: string; // app JWT (your HS256)
  user: { id: string; email: string; role: Role };
};

export const authStore = persistentAtom<AuthState | null>('cc_auth', null, {
  encode: JSON.stringify,
  decode: (s) => {
    try {
      return JSON.parse(s) as any;
    } catch {
      return null;
    }
  },
});

export function setAuth(a: AuthState) {
  authStore.set(a);
}

export function clearAuth() {
  authStore.set(null);
}
