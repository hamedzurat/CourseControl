import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import {
  admin as adminTable,
  baUser,
  enrollment,
  faculty as facultyTable,
  notification as notificationTable,
  phaseSchedule,
  section,
  sectionSelection,
  student as studentTable,
  subject,
} from '../db/schema';
import type { Env } from '../env';
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

  // ---- users ----
  if (Array.isArray(s.users) && s.users.length) {
    const nowIso = new Date().toISOString();
    await db
      .insert(baUser)
      .values(
        s.users.map((u: any) => ({
          id: String(u.id),
          name: String(u.name ?? 'User'),
          email: String(u.email),
          emailVerified: u.emailVerified ? 1 : 0,
          image: u.image ? String(u.image) : null,
          role: String(u.role ?? 'student'),
          createdAt: String(u.createdAt ?? nowIso),
          updatedAt: String(u.updatedAt ?? nowIso),
        })),
      )
      .onConflictDoUpdate({
        target: baUser.id,
        set: {
          name: baUser.name,
          email: baUser.email,
          emailVerified: baUser.emailVerified,
          image: baUser.image,
          role: baUser.role,
          updatedAt: nowIso,
        } as any,
      });

    summary.upserted.users = s.users.length;
  }

  // ---- role tables ----
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

  // ---- phase schedule ----
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

  // ---- subjects ----
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

  // ---- sections ----
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

  // ---- enrollments ----
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

  // ---- optional initial selections ----
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
