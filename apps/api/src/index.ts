import { Hono } from 'hono';
import { cors } from 'hono/cors';

import type { Env, Role } from './env';
import { authHandler } from './lib/auth';
import { requireJwt, requireRole } from './middleware/authz';
import { actorRoute } from './routes/actor';
import { adminDbRoute } from './routes/admin-db';
import { adminDebugRoute } from './routes/admin-debug';
import { authAppRoute } from './routes/auth-app';
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

app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://localhost:8787'],
    allowHeaders: ['Content-Type', 'Authorization', 'Upgrade-Insecure-Requests'],
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    exposeHeaders: ['Content-Length', 'X-Kuma-Revision'],
    maxAge: 600,
    credentials: true,
  }),
);

app.get('/health', (c) => c.json({ ok: true }));

// Only public endpoint:
app.route('/seed', seedRoute);

// App JWT mint endpoint (must come before /auth/* passthrough)
app.route('/auth/app', authAppRoute);

// Better Auth passthrough
app.on(['GET', 'POST'], '/auth/*', (c) => authHandler(c.env, c.req.raw));

// Public endpoints
app.route('/state.json', stateRoute);
app.route('/relation.json', relationRoute);

// Everything below requires app JWT
app.use('*', requireJwt);

app.route('/me', meRoute);
app.route('/phase', phaseRoute);

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
export { StudentDO } from './durable/objects/student';
export { SectionDO } from './durable/objects/section';
export { SubjectDO } from './durable/objects/subject';
export { EverythingDO } from './durable/objects/everything';
export { FacultyDO } from './durable/objects/faculty';
export { AdminDO } from './durable/objects/admin';
