export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthenticated = () => new AppError(401, 'unauthenticated', 'Sign in to continue.');
export const forbidden = (message = 'You do not have permission to do that.', details?: unknown) =>
  new AppError(403, 'forbidden', message, details);
export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found.`);
export const conflict = (message: string, code = 'conflict', details?: unknown) =>
  new AppError(409, code, message, details);
