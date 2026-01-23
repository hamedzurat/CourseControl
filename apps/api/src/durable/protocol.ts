import type { Role } from '../env';

export type ActionName =
  | 'take'
  | 'drop'
  | 'change'
  | 'group_create'
  | 'group_invite'
  | 'group_join'
  | 'group_leave'
  | 'group_disband'
  | 'group_take'
  | 'group_drop'
  | 'group_change'
  | 'swap_create'
  | 'swap_invite'
  | 'swap_join'
  | 'swap_exec'
  | 'cancel'
  | 'cancel_all'
  | 'message'
  | 'status';

export type QueueStatus = 'queued' | 'running' | 'ok' | 'error' | 'cancelled';

export type QueueItem = {
  id: string; // client-generated id (uuid-ish string ok)
  action: ActionName;
  createdAtMs: number;
  startedAtMs?: number;
  finishedAtMs?: number;
  status: QueueStatus;
  error?: { code: string; message: string };
  payload?: unknown; // stored as log, not authoritative
};

export type ClientHello = { type: 'hello'; token: string }; // optional if you ever want auth inside WS (you said auth at /actor only)
export type ClientAction = { type: 'action'; id: string; action: ActionName; payload?: any };
export type ClientPing = { type: 'ping'; t?: number };

export type ClientToServer = ClientHello | ClientAction | ClientPing;

export type ServerHello = {
  type: 'hello';
  actor: 'student' | 'faculty' | 'admin' | 'section' | 'subject' | 'everything';
  userId?: string;
  role?: Role;
  nowMs: number;
};

export type ServerError = {
  type: 'error';
  requestId?: string;
  code: string;
  message: string;
};

export type ServerQueueUpdate = {
  type: 'queue_update';
  item: QueueItem;
};

export type ServerStatus = {
  type: 'status';
  nowMs: number;
  phase?: 'pre' | 'selection' | 'between' | 'swap' | 'post';
  // actor-specific
  data?: any;
};

export type ServerChat = {
  type: 'chat';
  nowMs: number;
  fromUserId: string;
  toUserId: string;
  text: string;
};

export type ServerSeatStatus = {
  type: 'seat_status';
  nowMs: number;
  subjects: Record<string, any>; // subjectId -> KV blob (parsed)
};

export type ServerToClient =
  | ServerHello
  | ServerError
  | ServerQueueUpdate
  | ServerStatus
  | ServerChat
  | ServerSeatStatus;

// Small runtime guard
export function isClientAction(msg: any): msg is ClientAction {
  return msg && msg.type === 'action' && typeof msg.id === 'string' && typeof msg.action === 'string';
}
