/**
 * Low-level process primitives for the Claude Code wrapper.
 *
 * Two flavours, because the CLI has two very different execution modes:
 *
 * 1. `execOnce` — one-shot subcommands (`claude mcp list`, `claude auth status`,
 *    …). Resolves when the child exits. Uses a bounded timeout. Translates
 *    spawn/exit errors into typed `ClaudeCodeError` subclasses.
 *
 * 2. `spawnStream` — long-lived `claude -p --input-format stream-json
 *    --output-format stream-json` for interactive conversations. Returns a
 *    handle the caller uses to push user turns (stdin) and iterate events
 *    (stdout) until the child exits. Abort via `AbortSignal`.
 *
 * Neither primitive knows anything about the wire protocol — they just move
 * bytes. The stream-json schema lives in `types.ts` and parsing in `ndjson.ts`.
 */

import {
  spawn,
  type ChildProcessByStdio,
  type ChildProcess,
} from 'child_process'
import type { Readable, Writable } from 'stream'

import { resolveForService } from '../../utils/resolve-cli.ts'
import { createLogger } from '@apackdev/sdk/logger'

import { decodeNdjson, encodeNdjsonLine, type DecodedLine } from './ndjson.ts'
import {
  ClaudeAbortError,
  ClaudeCliNotFoundError,
  ClaudeExitError,
  ClaudeTimeoutError,
} from './errors.ts'

const logger = createLogger('claude-code-runner')

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExecOnceOptions {
  cwd?: string
  /**
   * Override the env passed to the child. Defaults to a copy of `process.env`
   * with `ANTHROPIC_API_KEY` removed so the CLI uses its own stored auth
   * (`claude auth login`) instead of an env-var key meant for the server's
   * LLM client. Pass an explicit object if you want no scrubbing — the
   * helper assumes you know what you're doing and does not post-process it.
   */
  env?: NodeJS.ProcessEnv
  /** Bytes piped to stdin. Pass `undefined` to leave stdin closed. */
  input?: string
  /** Milliseconds until the child is SIGKILL'd and a ClaudeTimeoutError thrown. */
  timeoutMs?: number
  signal?: AbortSignal
  /** Override the resolved CLI path (primarily for testing). */
  cliPath?: string
}

export interface ExecOnceResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface SpawnStreamOptions {
  cwd?: string
  /**
   * Override the env passed to the child. Defaults to a copy of `process.env`
   * with `ANTHROPIC_API_KEY` removed so the CLI uses its own stored auth
   * (`claude auth login`) instead of an env-var key meant for the server's
   * LLM client. Pass an explicit object if you want no scrubbing — the
   * helper assumes you know what you're doing and does not post-process it.
   */
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  cliPath?: string
}

/** Handle returned by `spawnStream`. Close when done. */
export interface StreamHandle {
  readonly child: ChildProcess
  /** Parsed NDJSON lines from stdout. Completes when the child exits. */
  readonly lines: AsyncIterable<DecodedLine>
  /** Write one JSON value as a framed NDJSON line to stdin. Returns false if stdin is closed. */
  write(value: unknown): boolean
  /** Close stdin (signals end-of-input to the CLI). */
  endInput(): void
  /** Wait for the child to exit. Resolves with the exit code. */
  done(): Promise<{ exitCode: number; signal: NodeJS.Signals | null; stderr: string }>
  /** Forcefully kill the child. */
  kill(signal?: NodeJS.Signals): void
}

// ─── Env scrubbing ───────────────────────────────────────────────────────────

/**
 * Build the environment for a spawned Claude CLI child process.
 *
 * The API server auto-loads `packages/api/.env` via `dotenv/config`, so a
 * developer's `ANTHROPIC_API_KEY` can be in its environment (the app's own
 * model calls don't read it: `services.inference` uses the key selected in
 * Settings → Secrets). The Claude CLI treats env-var API keys as an
 * "external" credential and prefers them over the user's stored
 * `claude auth login` session — so without this scrub, every CLI
 * subprocess we spawn would try to authenticate with that key and
 * fail with "Invalid API key · Fix external API key".
 *
 * If the caller explicitly passes an `env` override, we assume they know
 * what they're doing (e.g. an integration test or a truly external key)
 * and leave it untouched.
 *
 * Exported for direct unit testing — testing via the real `spawn()` path
 * would require mocking `child_process`, which is needlessly heavy for a
 * pure function.
 */
export function buildChildEnv(override?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...override }
  delete env.ANTHROPIC_API_KEY
  delete env.NODE_ENV

  // Let the CLI and explicit caller environment own deferred tool discovery.
  // Current native ToolSearch can load ExitPlanMode before its approval request.

  // Enable Claude Code's file-history checkpointing in SDK / non-interactive
  // mode. Without this, `fileHistoryEnabled()` in
  //   packages/claude-code/src/utils/fileHistory.ts
  // returns false under --print (which we always use), so no per-turn file
  // snapshots are recorded AND `--rewind-files` bails with
  //   "File rewinding is not enabled."
  // Claude's interactive TUI never hits this gate (different code path), so
  // matching it requires opting into the SDK equivalent explicitly. Callers
  // can still override by setting the env var themselves (including to '').
  if (env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING === undefined) {
    env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = 'true'
  }

  return env
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run the Claude CLI once, return its captured stdout/stderr.
 *
 * Use this for subcommands that print JSON or text and exit. For streaming
 * conversations use `spawnStream` instead.
 */
export async function execOnce(
  args: readonly string[],
  opts: ExecOnceOptions = {},
): Promise<ExecOnceResult> {
  const cliPath = opts.cliPath ?? await resolveForService('claude-code')
  const timeoutMs = opts.timeoutMs ?? 30_000

  return new Promise<ExecOnceResult>((resolve, reject) => {
    const chunksOut: Buffer[] = []
    const chunksErr: Buffer[] = []
    let settled = false

    // Timer must be created before spawn so the timeout also covers spawn itself.
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      fn()
    }

    const timer = setTimeout(() => {
      child?.kill('SIGKILL')
      settle(() => reject(new ClaudeTimeoutError(timeoutMs, args)))
    }, timeoutMs)

    let child: ChildProcess
    try {
      child = spawn(cliPath, args as string[], {
        cwd: opts.cwd,
        env: buildChildEnv(opts.env),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      clearTimeout(timer)
      reject(wrapSpawnError(err, cliPath))
      return
    }

    const onAbort = () => {
      child.kill('SIGTERM')
      settle(() => reject(new ClaudeAbortError(opts.signal?.reason)))
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
        settle(() => reject(new ClaudeExitError(code, signal, stderr, args)))
      }
    })

    if (opts.input !== undefined && child.stdin) {
      child.stdin.end(opts.input)
    } else {
      child.stdin?.end()
    }
  })
}

/**
 * Spawn the CLI for a long-lived streaming conversation.
 *
 * The caller drives the lifecycle: write stdin turns, iterate `lines`, then
 * call `endInput()` and `await done()`. If `signal` aborts, the child is
 * SIGTERM'd and `done()` rejects with `ClaudeAbortError`.
 */
export async function spawnStream(
  args: readonly string[],
  opts: SpawnStreamOptions = {},
): Promise<StreamHandle> {
  if (!opts.cwd) {
    throw new Error('spawnStream requires a cwd — refusing to fall back to process.cwd()')
  }
  const cliPath = opts.cliPath ?? await resolveForService('claude-code')

  let child: ChildProcessByStdio<Writable, Readable, Readable>
  try {
    child = spawn(cliPath, args as string[], {
      cwd: opts.cwd,
      env: buildChildEnv(opts.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessByStdio<Writable, Readable, Readable>
  } catch (err) {
    throw wrapSpawnError(err, cliPath)
  }

  // Collect stderr lazily for post-mortem on exit.
  const stderrChunks: Buffer[] = []
  child.stderr.on('data', c => stderrChunks.push(c))

  // Swallow expected pipe errors that occur when the child is killed mid-write.
  // Without this listener the error becomes an uncaughtException and crashes the server.
  child.stdin.on('error', (err: NodeJS.ErrnoException) => {
    const expected = ['EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED'];
    if (expected.includes(err.code ?? '')) {
      logger.warn('stdin write error after child exit (expected during kill)', { code: err.code, pid: child.pid })
    } else {
      logger.error('unexpected stdin error', { err, pid: child.pid })
    }
  })

  // One-shot promise that resolves on exit. Cached so multiple `done()`
  // calls are idempotent.
  const exitPromise = new Promise<{ exitCode: number; signal: NodeJS.Signals | null; stderr: string }>(
    (resolve, reject) => {
      child.once('error', err => reject(wrapSpawnError(err, cliPath)))
      child.once('close', (code, sig) => {
        resolve({
          exitCode: code ?? -1,
          signal: sig,
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
        })
      })
    },
  )

  // Honour external abort by SIGTERM'ing the child. The exit handler above
  // turns that into a normal resolve with a non-zero exit code; callers of
  // `done()` can classify it themselves.
  if (opts.signal) {
    if (opts.signal.aborted) {
      child.kill('SIGTERM')
    } else {
      opts.signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true })
    }
  }

  return {
    child,
    lines: decodeNdjson(child.stdout),
    write(value: unknown): boolean {
      if (!child.stdin.writable) {
        logger.warn('write to stdin failed — not writable', { pid: child.pid })
        return false
      }
      child.stdin.write(encodeNdjsonLine(value))
      return true
    },
    endInput(): void {
      if (child.stdin.writable) child.stdin.end()
    },
    done(): Promise<{ exitCode: number; signal: NodeJS.Signals | null; stderr: string }> {
      return exitPromise
    },
    kill(signal: NodeJS.Signals = 'SIGTERM'): void {
      child.kill(signal)
    },
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

function wrapSpawnError(err: unknown, cliPath: string): Error {
  const e = err as NodeJS.ErrnoException
  if (e?.code === 'ENOENT' || e?.code === 'EACCES') {
    return new ClaudeCliNotFoundError(cliPath, err)
  }
  return err instanceof Error ? err : new Error(String(err))
}
