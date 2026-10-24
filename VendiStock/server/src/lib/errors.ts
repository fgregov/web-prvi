export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Potrebna je prijava.') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Nemate ovlasti za ovu radnju.') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Zapis nije pronađen.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);
export const tooMany = (message: string) => new AppError(429, 'TOO_MANY_REQUESTS', message);
