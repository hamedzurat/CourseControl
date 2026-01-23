import { atom, map } from 'nanostores';

export type WsStatus =
  | { state: 'disconnected' }
  | { state: 'connecting' }
  | { state: 'connected' }
  | { state: 'error'; message: string };

export const wsStatus = atom<WsStatus>({ state: 'disconnected' });

// --- SHARED DATA ---

// 1. Seat Status (Selection Page)
export const seatStatus = map<any>({});

// 2. Student Status (Shared by ALL pages)
// Contains: enrolledSubjectIds, groups, swaps, selections, queue
export const placementStatus = map<any>({});
export const studentStatus = placementStatus; // Alias

// 3. Queue (Selection + Swap Page)
export const userQueue = atom<any[]>([]);

// 4. Invites (Groups Page)
export const groupInvites = atom<string[]>([]);

// 5. Swap Invites (Swap Page) -- NEW
export const swapInvites = atom<string[]>([]);

// 6. Faculty Status
export const facultyStatus = atom<any | null>(null);

// Debug Log
export const wsLog = atom<any[]>([]);
