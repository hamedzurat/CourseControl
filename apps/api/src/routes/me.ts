import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';

import {
  admin as adminTable,
  baUser,
  enrollment as enrollmentTable,
  faculty as facultyTable,
  groupMember as groupMemberTable,
  group as groupTable,
  sectionSelection,
  section as sectionTable,
  student as studentTable,
  subject as subjectTable,
  swapParticipant as swapParticipantTable,
  swap as swapTable,
} from '../db/schema';
import type { Env, Role } from '../env';
import { getDb } from '../lib/db';

type JwtUser = { id: string; email: string; role: Role };

export const meRoute = new Hono<{
  Bindings: Env;
  Variables: { jwtUser: JwtUser };
}>();

meRoute.get('/', async (c) => {
  const u = c.get('jwtUser');
  const db = getDb(c.env);

  const userRows = await db
    .select({ id: baUser.id, name: baUser.name, email: baUser.email, role: baUser.role, image: baUser.image })
    .from(baUser)
    .where(eq(baUser.id, u.id))
    .limit(1);

  if (!userRows.length) return c.json({ error: 'NOT_FOUND', message: 'User not found' }, 404);

  const user = userRows[0];

  // shared-ish
  const enrollments = await db
    .select({
      subjectId: subjectTable.id,
      code: subjectTable.code,
      name: subjectTable.name,
      credits: subjectTable.credits,
    })
    .from(enrollmentTable)
    .innerJoin(subjectTable, eq(enrollmentTable.subjectId, subjectTable.id))
    .where(eq(enrollmentTable.studentUserId, u.id))
    .orderBy(subjectTable.code);

  const selections = await db
    .select({
      subjectId: subjectTable.id,
      subjectCode: subjectTable.code,
      sectionId: sectionTable.id,
      sectionNumber: sectionTable.sectionNumber,
      timeslotMask: sectionTable.timeslotMask,
      maxSeats: sectionTable.maxSeats,
      facultyUserId: sectionTable.facultyUserId,
    })
    .from(sectionSelection)
    .innerJoin(sectionTable, eq(sectionSelection.sectionId, sectionTable.id))
    .innerJoin(subjectTable, eq(sectionSelection.subjectId, subjectTable.id))
    .where(eq(sectionSelection.studentUserId, u.id))
    .orderBy(subjectTable.code, sectionTable.sectionNumber);

  // groups (student)
  const groups = await db
    .select({
      groupId: groupTable.id,
      subjectId: groupTable.subjectId,
      leaderUserId: groupTable.leaderUserId,
      isLocked: groupTable.isLocked,
      createdAtMs: groupTable.createdAtMs,
    })
    .from(groupMemberTable)
    .innerJoin(groupTable, eq(groupMemberTable.groupId, groupTable.id))
    .where(eq(groupMemberTable.studentUserId, u.id))
    .orderBy(desc(groupTable.createdAtMs));

  // swaps: leader or participant
  const leaderSwapIds = await db.select({ id: swapTable.id }).from(swapTable).where(eq(swapTable.leaderUserId, u.id));
  const partSwapIds = await db
    .select({ id: swapParticipantTable.swapId })
    .from(swapParticipantTable)
    .where(eq(swapParticipantTable.userId, u.id));

  const swapIds = Array.from(new Set([...leaderSwapIds.map((x) => x.id), ...partSwapIds.map((x) => x.id)]));

  const swaps = swapIds.length
    ? await db
        .select({
          id: swapTable.id,
          leaderUserId: swapTable.leaderUserId,
          status: swapTable.status,
          createdAtMs: swapTable.createdAtMs,
          executedAtMs: swapTable.executedAtMs,
        })
        .from(swapTable)
        .where(inArray(swapTable.id, swapIds))
        .orderBy(desc(swapTable.createdAtMs))
    : [];

  const swapParticipants = swapIds.length
    ? await db
        .select({
          swapId: swapParticipantTable.swapId,
          userId: swapParticipantTable.userId,
          giveSectionId: swapParticipantTable.giveSectionId,
          wantSectionId: swapParticipantTable.wantSectionId,
          createdAtMs: swapParticipantTable.createdAtMs,
        })
        .from(swapParticipantTable)
        .where(inArray(swapParticipantTable.swapId, swapIds))
    : [];

  // role-specific profile
  let profile: any = null;
  if (u.role === 'student') {
    const r = await db.select().from(studentTable).where(eq(studentTable.userId, u.id)).limit(1);
    profile = r[0] ?? null;
  } else if (u.role === 'faculty') {
    const r = await db.select().from(facultyTable).where(eq(facultyTable.userId, u.id)).limit(1);
    profile = r[0] ?? null;
  } else if (u.role === 'admin') {
    const r = await db.select().from(adminTable).where(eq(adminTable.userId, u.id)).limit(1);
    profile = r[0] ?? null;
  }

  return c.json({
    user,
    profile,
    enrollments,
    selections,
    groups,
    swaps: swaps.map((s) => ({
      ...s,
      participants: swapParticipants.filter((p) => p.swapId === s.id),
    })),
  });
});
