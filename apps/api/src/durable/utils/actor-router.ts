import type { Env, Role } from '../../env';
import { AppError } from './errors';

export type ActorKind = 'student' | 'faculty' | 'admin' | 'section' | 'subject' | 'everything';

export function parseActorKind(kind: string): ActorKind {
  if (
    kind === 'student' ||
    kind === 'faculty' ||
    kind === 'admin' ||
    kind === 'section' ||
    kind === 'subject' ||
    kind === 'everything'
  )
    return kind;
  throw new AppError('INVALID_ACTOR', `Unknown actor kind: ${kind}`, 404);
}

export function actorNamespace(env: Env, kind: ActorKind): DurableObjectNamespace {
  switch (kind) {
    case 'student':
      return env.STUDENT_DO;
    case 'faculty':
      return env.FACULTY_DO;
    case 'admin':
      return env.ADMIN_DO;
    case 'section':
      return env.SECTION_DO;
    case 'subject':
      return env.SUBJECT_DO;
    case 'everything':
      return env.EVERYTHING_DO;
  }
}

export function actorNameForRequest(kind: ActorKind, user: { id: string; role: Role }, req: Request): string {
  // Most actors are per-user, some are singleton, and some are based on query param.
  const url = new URL(req.url);

  if (kind === 'student') return user.id;
  if (kind === 'faculty') return user.id;
  if (kind === 'admin') return user.id;

  if (kind === 'everything') return 'singleton';

  if (kind === 'section') {
    const sectionId = url.searchParams.get('id');
    if (!sectionId) throw new AppError('MISSING_ID', 'Missing query param: ?id=<sectionId>', 400);
    return sectionId;
  }

  if (kind === 'subject') {
    const subjectId = url.searchParams.get('id');
    if (!subjectId) throw new AppError('MISSING_ID', 'Missing query param: ?id=<subjectId>', 400);
    return subjectId;
  }

  // unreachable
  return 'unknown';
}

export function enforceActorAccess(kind: ActorKind, user: { id: string; role: Role }) {
  // route-level security so DO doesn't need to authenticate websocket
  if (kind === 'student' && user.role !== 'student') throw new AppError('FORBIDDEN', 'Student actor only', 403);
  if (kind === 'faculty' && user.role !== 'faculty') throw new AppError('FORBIDDEN', 'Faculty actor only', 403);
  if (kind === 'admin' && user.role !== 'admin') throw new AppError('FORBIDDEN', 'Admin actor only', 403);

  // section/subject/everything: any authenticated user can connect (read-only style) unless you later tighten.
}
