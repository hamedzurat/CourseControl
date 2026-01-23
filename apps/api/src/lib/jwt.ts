import { jwtVerify, SignJWT } from 'jose';

import type { Env, Role } from '../env';

const enc = new TextEncoder();

export type JwtClaims = {
  sub: string; // userId
  email: string;
  role: Role;
};

function secretKey(env: Env) {
  return enc.encode(env.BETTER_AUTH_SECRET);
}

export async function signAppJwt(env: Env, claims: JwtClaims, expiresInSeconds = 60 * 60 * 24 * 7) {
  const now = Math.floor(Date.now() / 1000);

  const jwt = await new SignJWT({
    email: claims.email,
    role: claims.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .setIssuer(env.JWT_ISSUER || env.BETTER_AUTH_BASE_URL || 'coursecontrol')
    .setAudience(env.JWT_AUDIENCE || 'coursecontrol')
    .sign(secretKey(env));

  return jwt;
}

export async function verifyAppJwt(env: Env, token: string): Promise<JwtClaims> {
  const { payload } = await jwtVerify(token, secretKey(env), {
    issuer: env.JWT_ISSUER || env.BETTER_AUTH_BASE_URL || 'coursecontrol',
    audience: env.JWT_AUDIENCE || 'coursecontrol',
  });

  const sub = String(payload.sub || '');
  const email = String((payload as any).email || '');
  const role = String((payload as any).role || 'student') as Role;

  if (!sub || !email) throw new Error('Invalid token payload');

  return { sub, email, role };
}
