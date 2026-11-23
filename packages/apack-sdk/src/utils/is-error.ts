/**
 * Cross-realm `Error.isError` (Node 24+ / ES2026) typed directly so source consumers compiling
 * `@apackdev/sdk` without `ESNext.Error` in `lib` still typecheck cleanly.
 */
export const isError = (value: unknown): value is Error =>
  (Error as ErrorConstructor & { isError(v: unknown): v is Error }).isError(value);
