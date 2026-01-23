import { AppError } from './errors';

export function json(data: any, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(headers || {}) },
  });
}

export function fail(code: string, message: string, status = 400): Response {
  return json({ error: code, message }, status);
}

export function fromError(e: unknown): Response {
  if (e instanceof AppError) return fail(e.code, e.message, e.status);
  return fail('INTERNAL_ERROR', 'Internal error', 500);
}
