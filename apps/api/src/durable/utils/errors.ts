export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function asAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof Error) return new AppError('INTERNAL_ERROR', e.message || 'Internal error', 500);
  return new AppError('INTERNAL_ERROR', 'Internal error', 500);
}
