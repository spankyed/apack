/** Why a repository refused: what it was asked about is gone, the input breaks its rules, or the operation failed */
export const RepositoryErrorCode = {
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  OPERATION_FAILED: 'OPERATION_FAILED',
} as const;

export type RepositoryErrorCode = typeof RepositoryErrorCode[keyof typeof RepositoryErrorCode];

/** A repository's refusal. `reportError` turns a `NOT_FOUND` into a message the user can act on */
export class RepositoryError extends Error {
  code: RepositoryErrorCode;
  constructor(message: string, code: RepositoryErrorCode) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
  }
}
