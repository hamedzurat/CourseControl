import { authStore } from '$lib/stores/auth';

export function requireRole(role: 'admin' | 'faculty' | 'student') {
  const a = authStore.get();
  if (!a) {
    location.href = '/login';
    return false;
  }
  if (a.user.role !== role) {
    location.href = '/';
    return false;
  }
  return true;
}
