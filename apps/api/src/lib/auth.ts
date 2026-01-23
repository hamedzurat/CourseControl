import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, captcha, jwt, multiSession } from 'better-auth/plugins';
import { oneTimeToken } from 'better-auth/plugins/one-time-token';

import type { Env, Role } from '../env';
import { getDb } from './db';
import { signAppJwt, verifyAppJwt } from './jwt';

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type JwtUser = { id: string; email: string; role: Role };

let _cached:
  | {
      key: string;
      auth: ReturnType<typeof betterAuth>;
    }
  | undefined;

function cacheKey(env: Env) {
  // Keep it stable per deployment/env config
  return [
    env.BETTER_AUTH_SECRET,
    env.BETTER_AUTH_BASE_URL,
    env.GOOGLE_CLIENT_ID ?? '',
    env.TURNSTILE_SECRET_KEY ?? '',
    env.JWT_ISSUER ?? '',
    env.JWT_AUDIENCE ?? '',
  ].join('|');
}

export function getAuth(env: Env) {
  const key = cacheKey(env);
  if (_cached?.key === key) return _cached.auth;

  const db = getDb(env);

  const plugins: any[] = [
    // Accept Authorization: Bearer ... as auth input for Better Auth endpoints when needed
    bearer(),
    // JWT + JWKS endpoints for Better Auth (separate from our app JWT)
    jwt(),
    // One-time token plugin
    oneTimeToken(),
    multiSession(),
  ];

  if (env.TURNSTILE_SECRET_KEY) {
    plugins.push(
      captcha({
        provider: 'cloudflare-turnstile',
        secretKey: env.TURNSTILE_SECRET_KEY,
      }),
    );
  }

  const auth = betterAuth({
    baseURL: env.BETTER_AUTH_BASE_URL,
    basePath: '/auth',

    database: drizzleAdapter(db as any, { provider: 'sqlite' }),

    emailAndPassword: {
      enabled: true,
    },

    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},

    plugins,
  });

  _cached = { key, auth };
  return auth;
}

export function authHandler(env: Env, req: Request) {
  return getAuth(env).handler(req);
}

export async function getBetterAuthSession(env: Env, req: Request) {
  // Better Auth server-side session lookup expects headers
  return getAuth(env).api.getSession({ headers: req.headers as any });
}

/**
 * Mint the "app JWT" (HS256) that *your API* uses for /phase, /state.json, /relation.json, /actor/*, etc.
 * This hits Better Auth only to validate the session (cookie or bearer) and to read user info once.
 */
export async function mintAppJwtFromRequest(env: Env, req: Request) {
  const session = (await getBetterAuthSession(env, req)) as any;
  if (!session?.user?.id || !session?.user?.email) {
    throw new HttpError(401, 'UNAUTHORIZED', 'No active session');
  }

  const role = (session.user.role ?? 'student') as Role;

  const token = await signAppJwt(env, {
    sub: String(session.user.id),
    email: String(session.user.email),
    role,
  });

  return { token, user: { id: String(session.user.id), email: String(session.user.email), role } };
}

/**
 * Verify "app JWT" from Authorization header.
 * This is what your Hono middleware uses to protect endpoints without hitting D1.
 */
export async function verifyJwtFromRequest(env: Env, req: Request) {
  let token: string | null = null;

  const authz = req.headers.get('authorization') || req.headers.get('Authorization');
  if (authz && authz.toLowerCase().startsWith('bearer ')) {
    token = authz.slice('bearer '.length).trim();
  }

  // WebSocket handshakes can't set Authorization in browsers,
  // so allow token via query param ONLY for Upgrade: websocket
  if (!token) {
    const up = req.headers.get('upgrade') || req.headers.get('Upgrade');
    if (up?.toLowerCase() === 'websocket') {
      const url = new URL(req.url);
      token = url.searchParams.get('token') || url.searchParams.get('t');
    }
  }

  if (!token) throw new HttpError(401, 'UNAUTHORIZED', 'Missing Bearer token');

  try {
    const claims = await verifyAppJwt(env, token);
    return { id: claims.sub, email: claims.email, role: claims.role };
  } catch {
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid token');
  }
}
