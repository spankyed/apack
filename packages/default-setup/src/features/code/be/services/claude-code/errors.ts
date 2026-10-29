/**
 * Typed error hierarchy for the Claude Code wrapper.
 *
 * Callers should branch on `err instanceof ClaudeCodeError` and then on the
 * concrete subclass. Every error carries structured context so logs and UIs
 * don't have to parse strings.
 */

export abstract class ClaudeCodeError extends Error {
  abstract readonly code: string
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = this.constructor.name
  }
}

/** The `claude` binary could not be located or is not executable. */
export class ClaudeCliNotFoundError extends ClaudeCodeError {
  readonly code = 'CLI_NOT_FOUND'
  constructor(readonly attemptedPath: string, cause?: unknown) {
    super(
      `Claude Code CLI not found at "${attemptedPath}". ` +
      `Install it from https://claude.ai/code or configure the path in Settings > Providers.`,
      cause,
    )
  }
}

/** The child process exited non-zero before or after emitting a result. */
export class ClaudeExitError extends ClaudeCodeError {
  readonly code = 'EXIT_NONZERO'
  constructor(
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stderr: string,
    readonly args: readonly string[],
  ) {
    super(
      `claude exited with code ${exitCode}${signal ? ` (signal ${signal})` : ''}` +
      (stderr ? `: ${stderr.trim().slice(-500)}` : ''),
    )
  }
}

/** A native result has an error subtype or is_error=true, including subtype=success refusals. */
export class ClaudeResultError extends ClaudeCodeError {
  readonly code = 'RESULT_ERROR'
  constructor(
    readonly subtype: string,
    readonly errors: readonly string[],
    readonly sessionId: string | undefined,
  ) {
    super(`claude result error [${subtype}]: ${errors.join('; ') || '(no detail)'}`)
  }
}

/** The operation was aborted via AbortSignal. */
export class ClaudeAbortError extends ClaudeCodeError {
  readonly code = 'ABORTED'
  constructor(reason?: unknown) {
    super('Claude Code operation was aborted', reason)
  }
}

/** A one-shot command could not receive its stdin payload. */
export class ClaudeInputError extends ClaudeCodeError {
  readonly code = 'INPUT_FAILED'
  constructor(cause?: unknown) {
    super('Failed to write input to Claude Code', cause)
  }
}

/** A one-shot subcommand exceeded its timeout budget. */
export class ClaudeTimeoutError extends ClaudeCodeError {
  readonly code = 'TIMEOUT'
  constructor(readonly timeoutMs: number, readonly args: readonly string[]) {
    super(`claude ${args.join(' ')} timed out after ${timeoutMs}ms`)
  }
}

/** The CLI emitted a line we could not JSON.parse. */
export class ClaudeProtocolError extends ClaudeCodeError {
  readonly code = 'PROTOCOL_ERROR'
  constructor(message: string, readonly raw?: string, cause?: unknown) {
    super(`Claude stream-json protocol error: ${message}`, cause)
  }
}
