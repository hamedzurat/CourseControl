import { Hono } from 'hono';

type Env = {};

const app = new Hono<{ Bindings: Env }>();

// request id for idempotency + tracing
app.use('*', async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const requestId = incoming ?? crypto.randomUUID();
  c.header('x-request-id', requestId);
  (c as any).requestId = requestId;
  await next();
});

app.get('/health', (c) => c.json({ ok: true }));

export default app;
