export type ErrorCode =
  | 'BAD_INPUT'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EXPIRED'
  | 'RATE_LIMIT'
  | 'UNAVAILABLE';
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new AppError('BAD_INPUT', 'Ожидался объект');
  return value as Record<string, unknown>;
}
export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new AppError('BAD_INPUT', 'Число вне допустимых границ');
  return value;
}
export function text(value: unknown, min = 1, max = 200): string {
  if (typeof value !== 'string' || value.length < min || value.length > max)
    throw new AppError('BAD_INPUT', 'Некорректная строка');
  return value;
}
export function oneOf<const T extends readonly string[]>(value: unknown, choices: T): T[number] {
  if (typeof value !== 'string' || !choices.includes(value))
    throw new AppError('BAD_INPUT', 'Неизвестное значение');
  return value as T[number];
}
