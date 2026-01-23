import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Better Auth core tables (table names must match what you query/admin-read)
 * We export `baUser` etc but table names are: user/session/account/verification/jwks
 */

export const baUser = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(), // Better Auth uses string ids
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    // Custom field for CourseControl:
    role: text('role').notNull().default('student'),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    emailUx: uniqueIndex('user_email_ux').on(t.email),
    roleIdx: index('user_role_idx').on(t.role),
  }),
);

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => baUser.id),
    token: text('token').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    userIdx: index('session_user_idx').on(t.userId),
    tokenUx: uniqueIndex('session_token_ux').on(t.token),
    expIdx: index('session_exp_idx').on(t.expiresAt),
  }),
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => baUser.id),
    providerId: text('providerId').notNull(), // e.g. "google"
    accountId: text('accountId').notNull(),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
    tokenType: text('tokenType'),
    scope: text('scope'),
    idToken: text('idToken'),
    sessionState: text('sessionState'),
    password: text('password'), // Add password for credential provider
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    userIdx: index('account_user_idx').on(t.userId),
    providerUx: uniqueIndex('account_provider_ux').on(t.providerId, t.accountId),
  }),
);

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(), // email or whatever
    value: text('value').notNull(), // token/code hash
    expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }),
  },
  (t) => ({
    identIdx: index('verification_ident_idx').on(t.identifier),
    expIdx: index('verification_exp_idx').on(t.expiresAt),
  }),
);

export const jwks = sqliteTable(
  'jwks',
  {
    id: text('id').primaryKey(),
    kid: text('kid').notNull(),
    key: text('key').notNull(), // JWK JSON string
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    kidUx: uniqueIndex('jwks_kid_ux').on(t.kid),
  }),
);

/** Role profile tables */
export const admin = sqliteTable('admin', {
  userId: text('userId')
    .primaryKey()
    .references(() => baUser.id),
});

export const faculty = sqliteTable('faculty', {
  userId: text('userId')
    .primaryKey()
    .references(() => baUser.id),
});

export const student = sqliteTable('student', {
  userId: text('userId')
    .primaryKey()
    .references(() => baUser.id),
  trimesterId: integer('trimesterId').notNull(),
  advisorUserId: text('advisorUserId').references(() => baUser.id),
});

/** Phase scheduling */
export const phaseSchedule = sqliteTable(
  'phase_schedule',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    selectionStartMs: integer('selectionStartMs').notNull(),
    selectionEndMs: integer('selectionEndMs').notNull(),
    swapStartMs: integer('swapStartMs').notNull(),
    swapEndMs: integer('swapEndMs').notNull(),
    createdAtMs: integer('createdAtMs').notNull(),
  },
  (t) => ({
    createdIdx: index('phase_created_idx').on(t.createdAtMs),
  }),
);

/** Catalog: subjects & sections */
export const subject = sqliteTable(
  'subject',
  {
    id: integer('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull().default('theory'),
    credits: integer('credits').notNull(),
    published: integer('published').notNull().default(0), // 0/1
  },
  (t) => ({
    codeUx: uniqueIndex('subject_code_ux').on(t.code),
    publishedIdx: index('subject_published_idx').on(t.published),
  }),
);

export const section = sqliteTable(
  'section',
  {
    id: integer('id').primaryKey(),
    subjectId: integer('subjectId')
      .notNull()
      .references(() => subject.id),
    sectionNumber: text('sectionNumber').notNull(),
    facultyUserId: text('facultyUserId')
      .notNull()
      .references(() => baUser.id),
    maxSeats: integer('maxSeats').notNull(),
    timeslotMask: integer('timeslotMask').notNull(),
    published: integer('published').notNull().default(0), // 0/1
  },
  (t) => ({
    subjIdx: index('section_subject_idx').on(t.subjectId),
    facIdx: index('section_faculty_idx').on(t.facultyUserId),
    publishedIdx: index('section_published_idx').on(t.published),
  }),
);

/** Enrollment: Student is allowed to operate only on enrolled subjects (business rule) */
export const enrollment = sqliteTable(
  'enrollment',
  {
    studentUserId: text('studentUserId')
      .notNull()
      .references(() => baUser.id),
    subjectId: integer('subjectId')
      .notNull()
      .references(() => subject.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.studentUserId, t.subjectId], name: 'enrollment_pk' }),
    subjIdx: index('enrollment_subject_idx').on(t.subjectId),
  }),
);

/** Selection truth in D1 (used for swaps + snapshots) */
export const sectionSelection = sqliteTable(
  'section_selection',
  {
    studentUserId: text('studentUserId')
      .notNull()
      .references(() => baUser.id),
    subjectId: integer('subjectId')
      .notNull()
      .references(() => subject.id),
    sectionId: integer('sectionId')
      .notNull()
      .references(() => section.id),
    selectedAtMs: integer('selectedAtMs').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.studentUserId, t.subjectId], name: 'section_selection_pk' }),
    sectionIdx: index('section_selection_section_idx').on(t.sectionId),
    subjectIdx: index('section_selection_subject_idx').on(t.subjectId),
  }),
);

/** Groups (for selection phase) */
export const group = sqliteTable(
  'group',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    subjectId: integer('subjectId')
      .notNull()
      .references(() => subject.id),
    leaderUserId: text('leaderUserId')
      .notNull()
      .references(() => baUser.id),
    isLocked: integer('isLocked').notNull().default(0), // 0/1
    createdAtMs: integer('createdAtMs').notNull(),
  },
  (t) => ({
    subjectIdx: index('group_subject_idx').on(t.subjectId),
    leaderIdx: index('group_leader_idx').on(t.leaderUserId),
    lockedIdx: index('group_locked_idx').on(t.isLocked),
  }),
);

export const groupMember = sqliteTable(
  'group_member',
  {
    groupId: integer('groupId')
      .notNull()
      .references(() => group.id),
    studentUserId: text('studentUserId')
      .notNull()
      .references(() => baUser.id),
    joinedAtMs: integer('joinedAtMs').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.groupId, t.studentUserId], name: 'group_member_pk' }),
    userIdx: index('group_member_user_idx').on(t.studentUserId),
  }),
);

export const groupInvite = sqliteTable(
  'group_invite',
  {
    code: text('code').primaryKey(),
    groupId: integer('groupId')
      .notNull()
      .references(() => group.id),
    createdAtMs: integer('createdAtMs').notNull(),
    expiresAtMs: integer('expiresAtMs'),
    usedByUserId: text('usedByUserId').references(() => baUser.id),
    usedAtMs: integer('usedAtMs'),
  },
  (t) => ({
    groupIdx: index('group_invite_group_idx').on(t.groupId),
    usedIdx: index('group_invite_used_idx').on(t.usedByUserId),
  }),
);

/** Swaps (swap phase) */
export const swap = sqliteTable(
  'swap',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    leaderUserId: text('leaderUserId')
      .notNull()
      .references(() => baUser.id),
    status: text('status').notNull(), // "open" | "locked" | "executed"
    createdAtMs: integer('createdAtMs').notNull(),
    executedAtMs: integer('executedAtMs'),
  },
  (t) => ({
    leaderIdx: index('swap_leader_idx').on(t.leaderUserId),
    statusIdx: index('swap_status_idx').on(t.status),
  }),
);

export const swapInvite = sqliteTable(
  'swap_invite',
  {
    code: text('code').primaryKey(),
    swapId: integer('swapId')
      .notNull()
      .references(() => swap.id),
    createdAtMs: integer('createdAtMs').notNull(),
    expiresAtMs: integer('expiresAtMs'),
    usedByUserId: text('usedByUserId').references(() => baUser.id),
    usedAtMs: integer('usedAtMs'),
  },
  (t) => ({
    swapIdx: index('swap_invite_swap_idx').on(t.swapId),
    usedIdx: index('swap_invite_used_idx').on(t.usedByUserId),
  }),
);

export const swapParticipant = sqliteTable(
  'swap_participant',
  {
    swapId: integer('swapId')
      .notNull()
      .references(() => swap.id),
    userId: text('userId')
      .notNull()
      .references(() => baUser.id),
    giveSectionId: integer('giveSectionId')
      .notNull()
      .references(() => section.id),
    wantSectionId: integer('wantSectionId')
      .notNull()
      .references(() => section.id),
    createdAtMs: integer('createdAtMs').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.swapId, t.userId], name: 'swap_participant_pk' }),
    swapIdx: index('swap_participant_swap_idx').on(t.swapId),
    userIdx: index('swap_participant_user_idx').on(t.userId),
  }),
);

/** Notifications (REST) */
export const notification = sqliteTable(
  'notification',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    createdByUserId: text('createdByUserId').notNull(), // "system" allowed
    audienceRole: text('audienceRole'), // nullable
    audienceUserId: text('audienceUserId'), // nullable
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdAtMs: integer('createdAtMs').notNull(),
  },
  (t) => ({
    createdIdx: index('notification_created_idx').on(t.createdAtMs),
    roleIdx: index('notification_role_idx').on(t.audienceRole),
    userIdx: index('notification_user_idx').on(t.audienceUserId),
  }),
);
