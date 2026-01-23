import { Hono } from 'hono';

import type { Env, Role } from './env';
import { authHandler } from './lib/auth';
import { requireJwt, requireRole } from './middleware/authz';
import { actorRoute } from './routes/actor';
import { adminDbRoute } from './routes/admin-db';
import { adminDebugRoute } from './routes/admin-debug';
import { authAppRoute } from './routes/auth-app';
import { authDevRoute } from './routes/auth-dev';
import { doStartRoute } from './routes/do-start';
import { meRoute } from './routes/me';
import { notificationRoute } from './routes/notification';
import { phaseRoute } from './routes/phase';
import { relationRoute } from './routes/relation';
import { seedRoute } from './routes/seed';
import { stateRoute } from './routes/state';

type JwtUser = { id: string; email: string; role: Role };

const app = new Hono<{
  Bindings: Env;
  Variables: { jwtUser: JwtUser };
}>();

app.get('/health', (c) => c.json({ ok: true }));

// Only public endpoint:
app.route('/seed', seedRoute);

// App JWT mint endpoint (must come before /auth/* passthrough)
app.route('/auth/app', authAppRoute);
app.route('/auth/dev', authDevRoute);

// Better Auth passthrough
app.on(['GET', 'POST'], '/auth/*', (c) => authHandler(c.env, c.req.raw));

// Everything below requires app JWT
app.use('*', requireJwt);

app.route('/me', meRoute);
app.route('/phase', phaseRoute);
app.route('/state.json', stateRoute);
app.route('/relation.json', relationRoute);

// admin db debug
app.use('/admin/db', requireRole(['admin']));
app.use('/admin/db/*', requireRole(['admin']));
app.route('/admin/db', adminDbRoute);
app.route('/admin', adminDebugRoute);
app.route('/admin/do', doStartRoute);

// Notifications:
// - create: admin/faculty only
// - poll: any authed user
app.use('/notification/create', requireRole(['admin', 'faculty']));
app.route('/notification', notificationRoute);

// Actors websocket entrypoint (auth only here)
app.route('/actor', actorRoute);

export default app;
export type AppType = typeof app;

// Durable Object exports
export { StudentDO } from './actors/student';
export { SectionDO } from './actors/section';
export { SubjectDO } from './actors/subject';
export { EverythingDO } from './actors/everything';
export { FacultyDO } from './actors/faculty';
export { AdminDO } from './actors/admin';
