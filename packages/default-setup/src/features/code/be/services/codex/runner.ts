/**
 * Low-level one-shot process primitive for the Codex CLI.
 *
 * Mirrors `claude-code/runner.ts:execOnce` but resolves the `codex` binary
 * and uses Codex-appropriate env scrubbing.
 */

import { spawn, type ChildProcess } from 'child_process'
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
  if (err instanceof Error && 'code' in err && (err as any).code === 'ENOENT') {
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

  return new Promise<CodexExecResult>((resolve, reject) => {
    const chunksOut: Buffer[] = []
    const chunksErr: Buffer[] = []
    let settled = false

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      fn()
    }

    const timer = setTimeout(() => {
      child?.kill('SIGKILL')
      settle(() => reject(new CodexTimeoutError(timeoutMs, args)))
    }, timeoutMs)

    let child: ChildProcess
    try {
      child = spawn(cliPath, args as string[], {
        cwd: opts.cwd,
        env: buildCodexEnv(opts.env),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      clearTimeout(timer)
      reject(wrapSpawnError(err, cliPath))
      return
    }

    const onAbort = () => {
      child.kill('SIGTERM')
      settle(() => reject(new Error('Codex operation was aborted')))
    }
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort()
        return
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.on('data', c => chunksOut.push(c))
    child.stderr?.on('data', c => chunksErr.push(c))

    child.on('error', err => settle(() => reject(wrapSpawnError(err, cliPath))))

    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(chunksOut).toString('utf8')
      const stderr = Buffer.concat(chunksErr).toString('utf8')
      if (code === 0) {
        settle(() => resolve({ stdout, stderr, exitCode: 0 }))
      } else {
        settle(() => reject(new CodexExitError(code, signal, stderr, args)))
      }
    })

    if (opts.input !== undefined && child.stdin) {
      child.stdin.end(opts.input)
    } else {
      child.stdin?.end()
    }
  })
}
