import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import {
  account,
  admin as adminTable,
  baUser,
  enrollment,
  faculty as facultyTable,
  notification as notificationTable,
  phaseSchedule,
  section,
  sectionSelection,
  session,
  student as studentTable,
  subject,
} from '../db/schema';
import type { Env } from '../env';
import { getAuth } from '../lib/auth';
import { getDb } from '../lib/db';
import { runMigrations } from '../lib/migrate';
import seed from '../seed.json';

export const seedRoute = new Hono<{ Bindings: Env }>();

seedRoute.get('/:secret', async (c) => {
  const secret = c.req.param('secret');
  if (secret !== c.env.PSEUDO_SECRET_ID) {
    return c.json({ error: 'forbidden' }, { status: 403 });
  }

  await runMigrations(c.env);
  const db = getDb(c.env);

  // Expect seed.json structure:
  // {
  //   users: [{id,name,email,role,image?}],
  //   students: [{userId, trimesterId, advisorUserId?}],
  //   faculty: [{userId}],
  //   admins: [{userId}],
  //   phaseSchedule: { selectionStartMs, selectionEndMs, swapStartMs, swapEndMs },
  //   subjects: [{id, code, name, credits, published?}],
  //   sections: [{id, subjectId, sectionNumber, facultyUserId, maxSeats, timeslotMask, published?}],
  //   enrollments: [{studentUserId, subjectId}],
  //   sectionSelections?: [{studentUserId, subjectId, sectionId, selectedAtMs?}],
  //   notifications?: [{createdByUserId, audienceRole?, audienceUserId?, title, body, createdAtMs?}]
  // }

  const s: any = seed as any;

  const summary: any = {
    migrated: true,
    upserted: {},
  };

  /** Users */
  if (Array.isArray(s.users) && s.users.length) {
    const auth = getAuth(c.env);
    const password = 'password'; // Default password for all seed users

    for (const u of s.users) {
      const email = String(u.email);
      const targetId = String(u.id);
      const name = String(u.name ?? 'User');
      const role = String(u.role ?? 'student');

      // Check if user exists
      const existing = await db.select().from(baUser).where(eq(baUser.email, email)).limit(1);

      if (existing.length === 0) {
        // Create user via Better Auth to handle password hashing
        try {
          const res = await auth.api.signUpEmail({
            body: {
              email,
              password,
              name,
            },
            asResponse: false,
          });

          // If ID differs (expected), path it to match seed ID
          if (res?.user?.id && res.user.id !== targetId) {
            const tempId = res.user.id;
            // Update user ID
            await db.update(baUser).set({ id: targetId, role, emailVerified: 1 }).where(eq(baUser.id, tempId));
            // Update relations that Better Auth created (account, session)
            await db.update(account).set({ userId: targetId }).where(eq(account.userId, tempId));
            await db.update(session).set({ userId: targetId }).where(eq(session.userId, tempId));
          } else {
            // ID matched or failed (should not happen with default generation, but handle update)
            await db.update(baUser).set({ role, emailVerified: 1 }).where(eq(baUser.id, targetId));
          }
        } catch (e) {
          console.error(`Failed to seed user ${email}:`, e);
        }
      } else {
        // Update existing user role/verification
        await db
          .update(baUser)
          .set({
            name,
            role,
            emailVerified: 1,
            image: u.image ? String(u.image) : baUser.image,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(baUser.email, email));
      }
    }
    summary.upserted.users = s.users.length;
  }

  /** Role tables */
  if (Array.isArray(s.admins) && s.admins.length) {
    await db
      .insert(adminTable)
      .values(s.admins.map((a: any) => ({ userId: String(a.userId) })))
      .onConflictDoNothing();
    summary.upserted.admins = s.admins.length;
  }

  if (Array.isArray(s.faculty) && s.faculty.length) {
    await db
      .insert(facultyTable)
      .values(s.faculty.map((f: any) => ({ userId: String(f.userId) })))
      .onConflictDoNothing();
    summary.upserted.faculty = s.faculty.length;
  }

  if (Array.isArray(s.students) && s.students.length) {
    await db
      .insert(studentTable)
      .values(
        s.students.map((st: any) => ({
          userId: String(st.userId),
          trimesterId: Number(st.trimesterId ?? 0),
          advisorUserId: st.advisorUserId ? String(st.advisorUserId) : null,
        })),
      )
      .onConflictDoUpdate({
        target: studentTable.userId,
        set: {
          trimesterId: studentTable.trimesterId,
          advisorUserId: studentTable.advisorUserId,
        } as any,
      });
    summary.upserted.students = s.students.length;
  }

  /** Phase schedule */
  if (s.phaseSchedule) {
    const ps = s.phaseSchedule;
    await db.insert(phaseSchedule).values({
      selectionStartMs: Number(ps.selectionStartMs),
      selectionEndMs: Number(ps.selectionEndMs),
      swapStartMs: Number(ps.swapStartMs),
      swapEndMs: Number(ps.swapEndMs),
      createdAtMs: Date.now(),
    });
    summary.upserted.phaseSchedule = 1;
  }

  /** Subjects */
  if (Array.isArray(s.subjects) && s.subjects.length) {
    await db
      .insert(subject)
      .values(
        s.subjects.map((x: any) => ({
          id: Number(x.id),
          code: String(x.code),
          name: String(x.name),
          type: String(x.type ?? 'theory'),
          credits: Number(x.credits),
          published: x.published == null ? 1 : Number(x.published),
        })),
      )
      .onConflictDoUpdate({
        target: subject.id,
        set: {
          code: subject.code,
          name: subject.name,
          type: subject.type,
          credits: subject.credits,
          published: subject.published,
        } as any,
      });
    summary.upserted.subjects = s.subjects.length;
  }

  /** Sections */
  if (Array.isArray(s.sections) && s.sections.length) {
    await db
      .insert(section)
      .values(
        s.sections.map((x: any) => ({
          id: Number(x.id),
          subjectId: Number(x.subjectId),
          sectionNumber: String(x.sectionNumber),
          facultyUserId: String(x.facultyUserId),
          maxSeats: Number(x.maxSeats),
          timeslotMask: Number(x.timeslotMask),
          published: x.published == null ? 1 : Number(x.published),
        })),
      )
      .onConflictDoUpdate({
        target: section.id,
        set: {
          subjectId: section.subjectId,
          sectionNumber: section.sectionNumber,
          facultyUserId: section.facultyUserId,
          maxSeats: section.maxSeats,
          timeslotMask: section.timeslotMask,
          published: section.published,
        } as any,
      });
    summary.upserted.sections = s.sections.length;
  }

  /** Enrollments */
  if (Array.isArray(s.enrollments) && s.enrollments.length) {
    await db
      .insert(enrollment)
      .values(
        s.enrollments.map((x: any) => ({
          studentUserId: String(x.studentUserId),
          subjectId: Number(x.subjectId),
        })),
      )
      .onConflictDoNothing();
    summary.upserted.enrollments = s.enrollments.length;
  }

  /** Initial Selections */
  if (Array.isArray(s.sectionSelections) && s.sectionSelections.length) {
    await db
      .insert(sectionSelection)
      .values(
        s.sectionSelections.map((x: any) => ({
          studentUserId: String(x.studentUserId),
          subjectId: Number(x.subjectId),
          sectionId: Number(x.sectionId),
          selectedAtMs: Number(x.selectedAtMs ?? Date.now()),
        })),
      )
      .onConflictDoUpdate({
        target: [sectionSelection.studentUserId, sectionSelection.subjectId],
        set: {
          sectionId: sectionSelection.sectionId,
          selectedAtMs: sectionSelection.selectedAtMs,
        } as any,
      });
    summary.upserted.sectionSelections = s.sectionSelections.length;
  }

  // ---- optional notifications ----
  if (Array.isArray(s.notifications) && s.notifications.length) {
    await db.insert(notificationTable).values(
      s.notifications.map((n: any) => ({
        createdByUserId: String(n.createdByUserId ?? 'system'),
        audienceRole: n.audienceRole ? String(n.audienceRole) : null,
        audienceUserId: n.audienceUserId ? String(n.audienceUserId) : null,
        title: String(n.title),
        body: String(n.body),
        createdAtMs: Number(n.createdAtMs ?? Date.now()),
      })),
    );
    summary.upserted.notifications = s.notifications.length;
  }

  // quick sanity: ensure we have at least one phase schedule
  const phase = await db.select().from(phaseSchedule).limit(1);
  summary.phaseScheduleExists = phase.length > 0;

  // quick sanity: subjects/sections published count
  const rel = await db.select({ s: subject.id }).from(subject).where(eq(subject.published, 1)).limit(1);
  summary.publishedSubjectsExists = rel.length > 0;

  return c.json(summary);
});
