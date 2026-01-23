import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';

import { baUser, section, subject } from '../db/schema';
import type { Env } from '../env';
import { getDb } from '../lib/db';

export const relationRoute = new Hono<{ Bindings: Env }>();

relationRoute.get('/', async (c) => {
  const db = getDb(c.env);

  const subjects = await db
    .select({
      id: subject.id,
      code: subject.code,
      name: subject.name,
      type: subject.type,
      credits: subject.credits,
    })
    .from(subject)
    .where(eq(subject.published, 1));

  const subjectIds = subjects.map((s) => s.id);

  const sections = subjectIds.length
    ? await db
        .select({
          id: section.id,
          subjectId: section.subjectId,
          sectionNumber: section.sectionNumber,
          facultyUserId: section.facultyUserId,
          maxSeats: section.maxSeats,
          timeslotMask: section.timeslotMask,
        })
        .from(section)
        .where(and(eq(section.published, 1), inArray(section.subjectId, subjectIds)))
    : [];

  const facultyIds = Array.from(new Set(sections.map((s) => s.facultyUserId)));
  const facultyRows = facultyIds.length
    ? await db
        .select({
          id: baUser.id,
          name: baUser.name,
          email: baUser.email,
          image: baUser.image,
          role: baUser.role,
        })
        .from(baUser)
        .where(inArray(baUser.id, facultyIds))
    : [];

  const facultyById = new Map(facultyRows.map((f) => [f.id, f]));

  const sectionsBySubject: Record<string, any[]> = {};
  for (const sec of sections) {
    const key = String(sec.subjectId);
    if (!sectionsBySubject[key]) sectionsBySubject[key] = [];

    const fac = facultyById.get(sec.facultyUserId) ?? null;

    sectionsBySubject[key].push({
      id: sec.id,
      sectionNumber: sec.sectionNumber,
      faculty: fac
        ? { id: fac.id, name: fac.name, email: fac.email, image: fac.image }
        : { id: sec.facultyUserId, name: null, email: null, image: null },
      maxSeats: sec.maxSeats,
      timeslotMask: sec.timeslotMask,
    });
  }

  const relation = {
    generatedAtMs: Date.now(),
    subjects: subjects.map((s) => ({
      ...s,
      sections: sectionsBySubject[String(s.id)] ?? [],
    })),
  };

  return c.json(relation);
});
