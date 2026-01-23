import { apiFetch } from '$lib/api/fetch';

export async function pollNotifications(sinceMs?: number) {
  const qs = sinceMs ? `?sinceMs=${encodeURIComponent(String(sinceMs))}` : '';
  return apiFetch<{ nowMs: number; sinceMs: number; items: any[] }>(`/notification/poll${qs}`);
}

export async function createNotification(input: {
  audienceRole?: 'student' | 'faculty' | 'admin' | null;
  audienceUserId?: string | null;
  title: string;
  body: string;
}) {
  return apiFetch<{ ok: true }>(`/notification/create`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
