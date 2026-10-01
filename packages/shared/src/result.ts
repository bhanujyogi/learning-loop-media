/** Minimal typed Result for domain operations that can fail predictably. */
export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E = DomainError> = Ok<T> | Err<E>;

export interface DomainError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E = DomainError>(error: E): Err<E> => ({ ok: false, error });
export const domainError = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
): DomainError => ({ code, message, details });
