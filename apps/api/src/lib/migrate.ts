import type { Env } from '../env';

/**
 * Idempotent schema bootstrap for D1.
 * This is not drizzle-kit migrations; it's a pragmatic "CREATE TABLE IF NOT EXISTS" runner
 * so you can delete .wrangler and still bootstrap from /seed.
 */
export async function runMigrations(env: Env) {
  const stmts: string[] = [];

  // Better Auth core tables
  stmts.push(`
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      role TEXT NOT NULL DEFAULT 'student',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
  stmts.push(`CREATE UNIQUE INDEX IF NOT EXISTS user_email_ux ON "user"(email);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS user_role_idx ON "user"(role);`);

  stmts.push(`
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      expiresAt INTEGER NOT NULL,
      ipAddress TEXT,
      userAgent TEXT,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (userId) REFERENCES "user"(id)
    );
  `);
  stmts.push(`CREATE INDEX IF NOT EXISTS session_user_idx ON session(userId);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS session_exp_idx ON session(expiresAt);`);

  stmts.push(`
    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      providerId TEXT NOT NULL,
      providerAccountId TEXT NOT NULL,
      accessToken TEXT,
      refreshToken TEXT,
      expiresAt INTEGER,
      tokenType TEXT,
      scope TEXT,
      idToken TEXT,
      sessionState TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY (userId) REFERENCES "user"(id)
    );
  `);
  stmts.push(`CREATE INDEX IF NOT EXISTS account_user_idx ON account(userId);`);
  stmts.push(`CREATE UNIQUE INDEX IF NOT EXISTS account_provider_ux ON account(providerId, providerAccountId);`);

  stmts.push(`
    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY NOT NULL,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expiresAt INTEGER NOT NULL
    );
  `);
  stmts.push(`CREATE INDEX IF NOT EXISTS verification_ident_idx ON verification(identifier);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS verification_exp_idx ON verification(expiresAt);`);

  stmts.push(`
    CREATE TABLE IF NOT EXISTS jwks (
      id TEXT PRIMARY KEY NOT NULL,
      kid TEXT NOT NULL,
      key TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);
  stmts.push(`CREATE UNIQUE INDEX IF NOT EXISTS jwks_kid_ux ON jwks(kid);`);

  // Role profile tables
  stmts.push(`
    CREATE TABLE IF NOT EXISTS admin (
      userId TEXT PRIMARY KEY NOT NULL,
      FOREIGN KEY (userId) REFERENCES "user"(id)
    );
  `);
  stmts.push(`
    CREATE TABLE IF NOT EXISTS faculty (
      userId TEXT PRIMARY KEY NOT NULL,
      FOREIGN KEY (userId) REFERENCES "user"(id)
    );
  `);
  stmts.push(`
    CREATE TABLE IF NOT EXISTS student (
      userId TEXT PRIMARY KEY NOT NULL,
      trimesterId INTEGER NOT NULL,
      advisorUserId TEXT,
      FOREIGN KEY (userId) REFERENCES "user"(id),
      FOREIGN KEY (advisorUserId) REFERENCES "user"(id)
    );
  `);

  // Phase schedule
  stmts.push(`
    CREATE TABLE IF NOT EXISTS phase_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      selectionStartMs INTEGER NOT NULL,
      selectionEndMs INTEGER NOT NULL,
      swapStartMs INTEGER NOT NULL,
      swapEndMs INTEGER NOT NULL,
      createdAtMs INTEGER NOT NULL
    );
  `);
  stmts.push(`CREATE INDEX IF NOT EXISTS phase_created_idx ON phase_schedule(createdAtMs);`);

  // Catalog
  stmts.push(`
    CREATE TABLE IF NOT EXISTS subject (
      id INTEGER PRIMARY KEY NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'theory',
      credits INTEGER NOT NULL,
      published INTEGER NOT NULL DEFAULT 0
    );
  `);
  stmts.push(`CREATE UNIQUE INDEX IF NOT EXISTS subject_code_ux ON subject(code);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS subject_published_idx ON subject(published);`);

  stmts.push(`
    CREATE TABLE IF NOT EXISTS section (
      id INTEGER PRIMARY KEY NOT NULL,
      subjectId INTEGER NOT NULL,
      sectionNumber TEXT NOT NULL,
      facultyUserId TEXT NOT NULL,
      maxSeats INTEGER NOT NULL,
      timeslotMask INTEGER NOT NULL,
      published INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (subjectId) REFERENCES subject(id),
      FOREIGN KEY (facultyUserId) REFERENCES "user"(id)
    );
  `);
  stmts.push(`CREATE INDEX IF NOT EXISTS section_subject_idx ON section(subjectId);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS section_faculty_idx ON section(facultyUserId);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS section_published_idx ON section(published);`);

  // Enrollment
  stmts.push(`
    CREATE TABLE IF NOT EXISTS enrollment (
      studentUserId TEXT NOT NULL,
      subjectId INTEGER NOT NULL,
      PRIMARY KEY (studentUserId, subjectId),
      FOREIGN KEY (studentUserId) REFERENCES "user"(id),
      FOREIGN KEY (subjectId) REFERENCES subject(id)
    );
  `);
  stmts.push(`CREATE INDEX IF NOT EXISTS enrollment_subject_idx ON enrollment(subjectId);`);

  // Selection truth
  stmts.push(`
    CREATE TABLE IF NOT EXISTS section_selection (
      studentUserId TEXT NOT NULL,
      subjectId INTEGER NOT NULL,
      sectionId INTEGER NOT NULL,
      selectedAtMs INTEGER NOT NULL,
      PRIMARY KEY (studentUserId, subjectId),
      FOREIGN KEY (studentUserId) REFERENCES "user"(id),
      FOREIGN KEY (subjectId) REFERENCES subject(id),
      FOREIGN KEY (sectionId) REFERENCES section(id)
    );
  `);
  stmts.push(`CREATE INDEX IF NOT EXISTS section_selection_section_idx ON section_selection(sectionId);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS section_selection_subject_idx ON section_selection(subjectId);`);

  // Groups
  stmts.push(`
    CREATE TABLE IF NOT EXISTS "group" (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      subjectId INTEGER NOT NULL,
      leaderUserId TEXT NOT NULL,
      isLocked INTEGER NOT NULL DEFAULT 0,
      createdAtMs INTEGER NOT NULL,
      FOREIGN KEY (subjectId) REFERENCES subject(id),
      FOREIGN KEY (leaderUserId) REFERENCES "user"(id)
    );
  `);
  stmts.push(`CREATE INDEX IF NOT EXISTS group_subject_idx ON "group"(subjectId);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS group_leader_idx ON "group"(leaderUserId);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS group_locked_idx ON "group"(isLocked);`);

  stmts.push(`
    CREATE TABLE IF NOT EXISTS group_member (
      groupId INTEGER NOT NULL,
      studentUserId TEXT NOT NULL,
      joinedAtMs INTEGER NOT NULL,
      PRIMARY KEY (groupId, studentUserId),
      FOREIGN KEY (groupId) REFERENCES "group"(id),
      FOREIGN KEY (studentUserId) REFERENCES "user"(id)
    );
  `);
  stmts.push(`CREATE INDEX IF NOT EXISTS group_member_user_idx ON group_member(studentUserId);`);

  stmts.push(`
    CREATE TABLE IF NOT EXISTS group_invite (
      code TEXT PRIMARY KEY NOT NULL,
      groupId INTEGER NOT NULL,
      createdAtMs INTEGER NOT NULL,
      expiresAtMs INTEGER,
      usedByUserId TEXT,
      usedAtMs INTEGER,
      FOREIGN KEY (groupId) REFERENCES "group"(id),
      FOREIGN KEY (usedByUserId) REFERENCES "user"(id)
    );
  `);
  stmts.push(`CREATE INDEX IF NOT EXISTS group_invite_group_idx ON group_invite(groupId);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS group_invite_used_idx ON group_invite(usedByUserId);`);

  // Swaps
  stmts.push(`
    CREATE TABLE IF NOT EXISTS swap (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      leaderUserId TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAtMs INTEGER NOT NULL,
      executedAtMs INTEGER,
      FOREIGN KEY (leaderUserId) REFERENCES "user"(id)
    );
  `);
  stmts.push(`CREATE INDEX IF NOT EXISTS swap_leader_idx ON swap(leaderUserId);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS swap_status_idx ON swap(status);`);

  stmts.push(`
    CREATE TABLE IF NOT EXISTS swap_invite (
      code TEXT PRIMARY KEY NOT NULL,
      swapId INTEGER NOT NULL,
      createdAtMs INTEGER NOT NULL,
      expiresAtMs INTEGER,
      usedByUserId TEXT,
      usedAtMs INTEGER,
      FOREIGN KEY (swapId) REFERENCES swap(id),
      FOREIGN KEY (usedByUserId) REFERENCES "user"(id)
    );
  `);
  stmts.push(`CREATE INDEX IF NOT EXISTS swap_invite_swap_idx ON swap_invite(swapId);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS swap_invite_used_idx ON swap_invite(usedByUserId);`);

  stmts.push(`
    CREATE TABLE IF NOT EXISTS swap_participant (
      swapId INTEGER NOT NULL,
      userId TEXT NOT NULL,
      giveSectionId INTEGER NOT NULL,
      wantSectionId INTEGER NOT NULL,
      createdAtMs INTEGER NOT NULL,
      PRIMARY KEY (swapId, userId),
      FOREIGN KEY (swapId) REFERENCES swap(id),
      FOREIGN KEY (userId) REFERENCES "user"(id),
      FOREIGN KEY (giveSectionId) REFERENCES section(id),
      FOREIGN KEY (wantSectionId) REFERENCES section(id)
    );
  `);
  stmts.push(`CREATE INDEX IF NOT EXISTS swap_participant_swap_idx ON swap_participant(swapId);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS swap_participant_user_idx ON swap_participant(userId);`);

  // Notifications
  stmts.push(`
    CREATE TABLE IF NOT EXISTS notification (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      createdByUserId TEXT NOT NULL,
      audienceRole TEXT,
      audienceUserId TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      createdAtMs INTEGER NOT NULL
    );
  `);
  stmts.push(`CREATE INDEX IF NOT EXISTS notification_created_idx ON notification(createdAtMs);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS notification_role_idx ON notification(audienceRole);`);
  stmts.push(`CREATE INDEX IF NOT EXISTS notification_user_idx ON notification(audienceUserId);`);

  // Run sequentially (D1 doesn’t support multi-statement reliably in one call across all environments)
  for (const sql of stmts) {
    const trimmed = sql.trim();
    if (!trimmed) continue;
    await env.DB.prepare(trimmed).run();
  }
}
