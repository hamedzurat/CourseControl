import type { Env, Role } from '../../env';
import { AppError } from './errors';
import { resolveUserRole } from './user-role';

export type ChatEntry = {
  atMs: number;
  dir: 'in' | 'out';
  peerUserId: string;
  text: string;
};

export class ChatStore {
  private byPeer = new Map<string, ChatEntry[]>();

  addOut(toUserId: string, text: string, atMs = Date.now()) {
    this.add('out', toUserId, text, atMs);
  }

  addIn(fromUserId: string, text: string, atMs = Date.now()) {
    this.add('in', fromUserId, text, atMs);
  }

  history(peerUserId: string): ChatEntry[] {
    return this.byPeer.get(peerUserId) ?? [];
  }

  private add(dir: 'in' | 'out', peerUserId: string, text: string, atMs: number) {
    const arr = this.byPeer.get(peerUserId) ?? [];
    arr.push({ atMs, dir, peerUserId, text });
    while (arr.length > 20) arr.shift();
    this.byPeer.set(peerUserId, arr);
  }
}

function nsForRole(env: Env, role: Role): DurableObjectNamespace {
  if (role === 'student') return env.STUDENT_DO;
  if (role === 'faculty') return env.FACULTY_DO;
  return env.ADMIN_DO;
}

/**
 * Deliver a chat message to a user's DO (based on role).
 * Recipient DO must implement POST /message.
 */
export async function deliverMessage(env: Env, fromUserId: string, toUserId: string, text: string) {
  const role = await resolveUserRole(env, toUserId);
  const ns = nsForRole(env, role);

  const stub = ns.get(ns.idFromName(toUserId));
  const resp = await stub.fetch('https://do/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fromUserId, toUserId, text, atMs: Date.now() }),
  });

  if (!resp.ok) {
    throw new AppError('CHAT_DELIVERY_FAILED', `Failed to deliver message (${resp.status})`, 502);
  }
}
