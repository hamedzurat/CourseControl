import { atom } from 'nanostores';

export type FacultyStatus = {
  faculty: { id: string; name: string; email: string; image: string | null };
  subjects: { id: number; code: string; name: string }[];
  taughtSectionIds: number[];
};

export const facultyStatusStore = atom<FacultyStatus | null>(null);

export type StudentWsStatus = {
  // this is intentionally loose because backend status payload can evolve
  selections?: any[];
  queue?: any[];
  enrolledSubjectIds?: number[];
  groups?: any[];
  swaps?: any[];
  // sometimes StudentDO sends this on invite generation
  groupInvites?: string[];
};

export const studentStatusStore = atom<StudentWsStatus | null>(null);
export const seatStatusStore = atom<Record<string, any> | null>(null);

// "latest generated invite codes" (StudentDO sends via status.data.groupInvites)
export const groupInvitesStore = atom<string[]>([]);
