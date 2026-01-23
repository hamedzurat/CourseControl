import { PUBLIC_API_BASE } from '$env/static/public';

export const API_BASE = (PUBLIC_API_BASE ?? '').replace(/\/+$/, '');

if (!API_BASE) console.warn('PUBLIC_API_BASE is missing. Set it in apps/web/.env');

export function wsBaseFromHttp(apiBase: string) {
  return apiBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}
