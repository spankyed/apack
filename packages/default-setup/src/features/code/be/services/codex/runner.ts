/**
 * Low-level one-shot process primitive for the Codex CLI.
 *
 * Runs the child with `runProcess` (`@apackdev/sdk/progress`), which owns its
 * whole life, as `claude-code/runner.ts:execOnce` does, with the `codex`
 * binary and Codex-appropriate env scrubbing.
 */

import { describeRefusal, runProcess } from '@apackdev/sdk/progress'
import { resolveForService } from '../../utils/resolve-cli.ts'
import { agentChildEnvironment } from '../shell-environment.ts'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CodexExecOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  input?: string
  timeoutMs?: number
  signal?: AbortSignal
  cliPath?: string
}

export interface CodexExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

// ─── Errors ──────────────────────────────────────────────────────────────────

class CodexExitError extends Error {
  readonly code = 'EXIT_NONZERO'
  constructor(
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stderr: string,
    readonly args: readonly string[],
  ) {
    super(
      `codex exited with code ${exitCode}${signal ? ` (signal ${signal})` : ''}` +
      (stderr ? `: ${stderr.trim().slice(-500)}` : ''),
    )
    this.name = 'CodexExitError'
  }
}

class CodexTimeoutError extends Error {
  readonly code = 'TIMEOUT'
  constructor(readonly timeoutMs: number, readonly args: readonly string[]) {
    super(`codex ${args.join(' ')} timed out after ${timeoutMs}ms`)
    this.name = 'CodexTimeoutError'
  }
}

class CodexCliNotFoundError extends Error {
  readonly code = 'CLI_NOT_FOUND'
  constructor(readonly attemptedPath: string, cause?: unknown) {
    super(
      `Codex CLI not found at "${attemptedPath}". ` +
      `Install it via npm: npm i -g @openai/codex`,
    )
    this.name = 'CodexCliNotFoundError'
    if (cause) this.cause = cause
  }
}

// ─── Env ─────────────────────────────────────────────────────────────────────

function buildCodexEnv(override?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // **The app's identity is stripped before anything else is decided** (`agentChildEnvironment`). This child
  // is the widest case there is: its own tools spawn whatever the model asks for, in this environment
  const env: NodeJS.ProcessEnv = { ...agentChildEnvironment(process.env), ...override }
  // Remove the server's Anthropic key so it doesn't leak to the Codex subprocess
  delete env.ANTHROPIC_API_KEY
  delete env.NODE_ENV
  return env
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function wrapSpawnError(err: unknown, cliPath: string): Error {
  if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
    return new CodexCliNotFoundError(cliPath, err)
  }
  return err instanceof Error ? err : new Error(String(err))
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run the Codex CLI once, return its captured stdout/stderr.
 *
 * Used for one-shot tasks like commit message and DB query generation.
 * Resolves `codex` via the shared CLI resolver.
 */
export async function codexExec(
  args: readonly string[],
  opts: CodexExecOptions = {},
): Promise<CodexExecResult> {
  const cliPath = opts.cliPath ?? await resolveForService('codex')
  const timeoutMs = opts.timeoutMs ?? 30_000
  // The one clock here, and the caller's: a task that asks a model waits on the network, which no reading of the
  // child's CPU describes. Everything else about the child's life is `runProcess`'s
  const deadline = AbortSignal.timeout(timeoutMs)
  const outcome = await runProcess(cliPath, args, {
    cwd: opts.cwd,
    env: buildCodexEnv(opts.env),
    input: opts.input,
    signal: opts.signal === undefined ? deadline : AbortSignal.any([opts.signal, deadline]),
  })
  if (outcome.ok) return { stdout: outcome.stdout, stderr: outcome.stderr, exitCode: 0 }

  const { failure } = outcome
  switch (failure.kind) {
    case 'not-started': throw wrapSpawnError(failure.error, cliPath)
    case 'exited': throw new CodexExitError(failure.exitCode, failure.signal, failure.stderr, args)
    // Whichever signal aborted first is the reason the run was stopped for
    case 'aborted': throw failure.reason === deadline.reason
      ? new CodexTimeoutError(timeoutMs, args)
      : new Error('Codex operation was aborted', { cause: failure.reason })
    case 'refused': throw new Error(`codex ${args.join(' ')} was ended: it ${describeRefusal(failure.refusal)}`)
  }
}
