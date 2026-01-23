export type Role = 'student' | 'faculty' | 'admin';

export type Env = {
  // ---- Cloudflare storage ----
  DB: D1Database;

  KV_SUBJECT: KVNamespace;
  R2_STATE: R2Bucket;

  // ---- Durable Objects ----
  STUDENT_DO: DurableObjectNamespace;
  SECTION_DO: DurableObjectNamespace;
  SUBJECT_DO: DurableObjectNamespace;
  EVERYTHING_DO: DurableObjectNamespace;
  FACULTY_DO: DurableObjectNamespace;
  ADMIN_DO: DurableObjectNamespace;

  // ---- Seed ----
  PSEUDO_SECRET_ID: string;

  // ---- Better Auth base ----
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_BASE_URL: string; // your deployed origin, used by better-auth

  // Email/password flows (optional SMTP if you use it; Better Auth can also use tokens)
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;

  // Google OAuth
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  // Cloudflare Turnstile
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;

  // JWT
  JWT_ISSUER?: string;
  JWT_AUDIENCE?: string;
};
