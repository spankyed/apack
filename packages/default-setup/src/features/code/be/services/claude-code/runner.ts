/**
 * Low-level process primitives for the Claude Code wrapper.
 *
 * Two flavours, because the CLI has two very different execution modes:
 *
 * 1. `execOnce` — one-shot subcommands (`claude mcp list`, `claude auth status`,
 *    …). Runs the child with `runProcess` (`@apackdev/sdk/progress`), which
 *    owns its whole life, and translates each way it can fail into a typed
 *    `ClaudeCodeError` subclass. Settles once the child is gone.
 *
 * 2. `spawnStream` — long-lived `claude -p --input-format stream-json
 *    --output-format stream-json` for interactive conversations. Returns a
 *    handle the caller uses to push user turns (stdin) and iterate events
 *    (stdout) until the child exits. Abort via `AbortSignal`.
 *
 * Neither primitive knows anything about the wire protocol — they just move
 * bytes. The stream-json schema lives in `types.ts` and parsing in `ndjson.ts`.
 */

import { createStderrTail } from './stderr-tail.ts'
import {
  spawn,
  type ChildProcessByStdio,
  type ChildProcess,
} from 'child_process'
import { describeRefusal, runProcess } from '@apackdev/sdk/progress'
import type { Readable, Writable } from 'stream'

import { resolveForService } from '../../utils/resolve-cli.ts'
import { createLogger } from '@apackdev/sdk/logger'

import { decodeNdjson, encodeNdjsonLine, type DecodedLine } from './ndjson.ts'
import { agentChildEnvironment } from '../shell-environment.ts'
import {
  ClaudeAbortError,
  ClaudeCliNotFoundError,
  ClaudeExitError,
  ClaudeStalledError,
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
  /** Milliseconds on the clock until the child is stopped and a ClaudeTimeoutError thrown. */
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
 * The API server auto-loads `packages/server/.env` via `dotenv/config`, so a
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
  // **The app's own variables go first** (G2): this child, and everything its Bash tool spawns, inherited
  // `ELECTRON_RUN_AS_NODE=1`, `APACK_USER_DATA_DIR`, `SHIPPED_PACKS_DIR` and `API_PORT`. The strip is derived
  // from what the construction that sets them declares, so it cannot fall behind it; `NODE_ENV` is one of
  // the ten, which is why the hand-written delete below no longer names it.
  const env: NodeJS.ProcessEnv = { ...agentChildEnvironment(process.env), ...override }
  delete env.ANTHROPIC_API_KEY

  // Disable the CLI's tool-search / deferred-tool feature. Claude Code's
  // tool-search mode ships enabled by default — see leaked source at
  //   packages/claude-code/src/utils/toolSearch.ts:197
  //     `return 'tst' // default: always defer MCP and shouldDefer tools`
  // — and it hides every tool tagged `shouldDefer: true` from Claude's
  // initial tool list until ToolSearchTool has already emitted a prior
  // `tool_reference` block discovering it. On the first turn of a fresh
  // plan-mode session no such prior discoveries exist, so `ExitPlanMode`
  // (which has `shouldDefer: true` at
  //   packages/claude-code/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts:166
  // ) never appears in Claude's tools list. Claude reads the plan-mode
  // system reminder telling it to call ExitPlanMode but can't, falls
  // back to prose — "Would you like me to proceed with the
  // implementation?" — and bypasses our plan-approval flow in chat.ts's
  // onPermissionRequest closure entirely.
  //
  // apack doesn't have the monster MCP tool counts tool search was
  // designed to optimise, so the feature is pure downside for us.
  // Setting `ENABLE_TOOL_SEARCH=0` hits the `isEnvDefinedFalsy` branch
  // at `toolSearch.ts:196` → forces mode to `'standard'` → makes
  // `useToolSearch = false` at `claude.ts:1120` → the `!useToolSearch`
  // path at `claude.ts:1168-1171` includes every tool (ExitPlanMode,
  // NotebookEdit, LSPTool, …) in Claude's effective tools list from
  // turn 1. Plan approval flow then works on the first try.
  env.ENABLE_TOOL_SEARCH = '0'

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
  // The one clock here, and the caller's: a subcommand that asks a model waits on the network, which no reading
  // of the child's CPU describes. Everything else about the child's life is `runProcess`'s
  const deadline = AbortSignal.timeout(timeoutMs)
  const outcome = await runProcess(cliPath, args, {
    cwd: opts.cwd,
    env: buildChildEnv(opts.env),
    input: opts.input,
    signal: opts.signal === undefined ? deadline : AbortSignal.any([opts.signal, deadline]),
  })
  if (outcome.ok) return { stdout: outcome.stdout, stderr: outcome.stderr, exitCode: 0 }

  const { failure } = outcome
  switch (failure.kind) {
    case 'not-started': throw wrapSpawnError(failure.error, cliPath)
    case 'exited': throw new ClaudeExitError(failure.exitCode, failure.signal, failure.stderr, args)
    // Whichever signal aborted first is the reason the run was stopped for
    case 'aborted': throw failure.reason === deadline.reason
      ? new ClaudeTimeoutError(timeoutMs, args)
      : new ClaudeAbortError(failure.reason)
    case 'refused': throw new ClaudeStalledError(describeRefusal(failure.refusal), args)
  }
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

  // Collect stderr for post-mortem on exit, bounded: this child lives as long as the conversation does, so
  // an array of every chunk it ever wrote is a leak with that lifetime. The end is the part a post-mortem
  // reads, and what is dropped is counted rather than hidden
  const stderr = createStderrTail()
  child.stderr.on('data', (c: Buffer) => stderr.append(c))

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
          stderr: stderr.text(),
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
