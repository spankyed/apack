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

import { agentChildEnvironment } from '../shell-environment.ts'

import { createClaudeLifecycleTrace } from './lifecycle-trace.ts'
import { createStderrTail } from './stderr-tail.ts'
import { decodeNdjson, encodeNdjsonLine, type DecodedLine } from './ndjson.ts'
import {
  ClaudeAbortError,
  ClaudeCliNotFoundError,
  ClaudeExitError,
  ClaudeInputError,
  ClaudeTimeoutError,
} from './errors.ts'

const logger = createLogger('claude-code-runner')

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExecOnceOptions {
  cwd?: string
  /**
   * Merge overrides into the child environment, which is this process's minus everything the app set on it.
   * ANTHROPIC_API_KEY is always removed, including an explicit override. Native file checkpointing defaults
   * on only when its environment switch is unset.
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
   * Merge overrides into the child environment, which is this process's minus everything the app set on it.
   * ANTHROPIC_API_KEY is always removed, including an explicit override. Native file checkpointing defaults
   * on only when its environment switch is unset.
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
  /**
   * Wait for the child to exit for as long as it keeps working, and terminate it once it has gone silent.
   *
   * `exited: true` is a child that ended on its own; `exited: false` is one terminated for silence, whose
   * stdio may still be held open by something it started. See {@link EXIT_IDLE_MS}.
   */
  waitForExitWhileWorking(idleMs?: number): Promise<{ exited: boolean }>
  /** Forcefully kill the child. */
  kill(signal?: NodeJS.Signals): void
}

/**
 * How long a wait for the child to exit tolerates the child doing nothing at all.
 *
 * **Progress, not a clock.** Every line the child writes on stdout and every byte it writes on stderr starts
 * this over, so a child still doing its work is never cut off, however long that work takes. What it bounds is
 * silence: a child that has finished and holds a stdio pipe open — one grandchild of its own that inherited
 * the pipe is enough — pins the awaiting caller for the life of the process, and the conversation that caller
 * belongs to then reads as running until the app restarts.
 */
export const EXIT_IDLE_MS = 15_000

// ─── Env scrubbing ───────────────────────────────────────────────────────────

/**
 * Names the CLI must not see, whichever way it is started.
 *
 * **One declaration, because the two halves of keeping a name out would otherwise disagree.** A child this
 * process spawns gets an environment built here, where a delete is enough; a session the host's terminal
 * starts *inherits* the host's environment, so leaving a name out of the overrides leaves it inherited and
 * the request has to say `unset` instead. Both read this list.
 *
 * `ANTHROPIC_API_KEY` is the one on it: the CLI authenticates as whoever the user signed in as, and the API
 * can genuinely be carrying a key — it auto-loads `packages/api/.env` — which would make the CLI
 * authenticate as the app.
 */
export const DENIED_TO_A_CHILD = ['ANTHROPIC_API_KEY'] as const;

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
 * **Everything the app set on its own process is stripped first** (`agentChildEnvironment`): this child, and
 * every program its Bash tool spawns, would otherwise inherit `ELECTRON_RUN_AS_NODE=1`, `APACK_API_TOKEN`,
 * `APACK_USER_DATA_DIR`, `SHIPPED_PACKS_DIR`, `API_PORT` and the rest. The strip is derived from the same
 * declaration the construction in `@app/main` is typed by, so a variable added there is stripped here; it
 * covers `NODE_ENV`, which is why no delete below names it.
 *
 * Caller overrides are merged after that strip, so an override can set any of them deliberately.
 * ANTHROPIC_API_KEY is removed last and an explicit override does not bypass it. Other native switches pass
 * through, with checkpointing defaulted below only when unset. The parent and override objects stay unchanged.
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
  for (const name of DENIED_TO_A_CHILD) delete env[name]

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
      if (child?.pid !== undefined) child.kill('SIGKILL')
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
      if (child.pid !== undefined) child.kill('SIGTERM')
      // Aborting settles the call and clears its timeout, so termination needs
      // its own bound when the child ignores SIGTERM.
      const abortKillTimer = setTimeout(() => {
        if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 1000)
      abortKillTimer.unref()
      child.once('close', () => clearTimeout(abortKillTimer))
      settle(() => reject(new ClaudeAbortError(opts.signal?.reason)))
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

    child.stdin?.on('error', err => {
      if (settled) return
      if (child.pid !== undefined) child.kill('SIGKILL')
      settle(() => reject(new ClaudeInputError(err)))
    })

    // Install process/pipe listeners before an already-aborted signal can
    // settle this call; spawn errors and late pipe errors still need listeners.
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort()
        return
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }

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
 * sent SIGTERM, with SIGKILL after one second if it has not exited. `done()`
 * reports the observed exit so the query layer can classify cancellation.
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

  const trace = createClaudeLifecycleTrace('print', undefined, child.pid)
  trace('launch')
  child.once('spawn', () => trace('ready', {pid: child.pid}))
  // Anything waiting on the child's progress registers here, and every byte it writes tells them. The set is
  // empty whenever nobody is waiting, which is nearly always, so a chatty child pays nothing for it.
  const waitingOnProgress = new Set<() => void>()
  const madeProgress = () => { for (const notify of waitingOnProgress) notify() }

  // Drain throughout the process lifetime, retaining only bounded diagnostics.
  const stderrTail = createStderrTail()
  child.stderr.on('data', c => { stderrTail.append(c); madeProgress() })

  let exited = false
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const clearKillTimer = () => {
    if (killTimer) clearTimeout(killTimer)
    killTimer = undefined
  }
  const terminate = (signal: NodeJS.Signals = 'SIGTERM') => {
    // A failed spawn can still be awaiting its error event, with no child PID.
    if (exited || child.pid === undefined) return
    trace('cancel_requested')
    child.kill(signal)
    // A successful signal send does not prove that the child exited.
    if (signal !== 'SIGKILL' && !killTimer) {
      killTimer = setTimeout(() => {
        killTimer = undefined
        if (!exited) child.kill('SIGKILL')
      }, 1000)
      killTimer.unref()
    }
  }
  // A broken input pipe makes this bidirectional process unusable even if it keeps
  // stdout open. Termination lets the query/owner settle pending turns on exit.
  child.stdin.on('error', (err: NodeJS.ErrnoException) => {
    if (exited) {
      logger.warn('stdin write error after child exit', { code: err.code, pid: child.pid })
      return
    }
    logger.error('stdin failed while child was alive; terminating process', { code: err.code, pid: child.pid })
    terminate()
  })

  const onAbort = () => terminate()
  const cleanup = () => {
    exited = true
    clearKillTimer()
    opts.signal?.removeEventListener('abort', onAbort)
  }
  child.once('exit', cleanup)

  // One-shot promise that resolves on exit. Cached so multiple `done()`
  // calls are idempotent.
  const exitPromise = new Promise<{ exitCode: number; signal: NodeJS.Signals | null; stderr: string }>(
    (resolve, reject) => {
      child.once('error', err => { trace('exit', {outcome:'error'}); cleanup(); reject(wrapSpawnError(err, cliPath)) })
      child.once('close', (code, sig) => {
        trace('exit', {outcome: code === 0 ? 'ok' : sig ? 'cancelled' : 'error', code: code ?? undefined, discardedBytes: stderrTail.discardedBytes})
        cleanup()
        resolve({
          exitCode: code ?? -1,
          signal: sig,
          stderr: stderrTail.text(),
        })
      })
    },
  )

  // Honour external abort with bounded termination. The exit handler above
  // turns that into a normal resolve with a non-zero exit code; callers of
  // `done()` can classify it themselves.
  if (opts.signal) {
    if (opts.signal.aborted) {
      onAbort()
    } else {
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }
  }

  // Every line the consumer pulls is progress by the child that wrote it, which is what bounds the wait below.
  async function* observedLines(): AsyncGenerator<DecodedLine> {
    for await (const line of decodeNdjson(child.stdout)) {
      madeProgress()
      yield line
    }
  }

  return {
    child,
    lines: observedLines(),
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
    waitForExitWhileWorking(idleMs: number = EXIT_IDLE_MS): Promise<{ exited: boolean }> {
      return new Promise<{ exited: boolean }>(resolve => {
        let settled = false
        let silenceTimer: ReturnType<typeof setTimeout> | undefined
        const finish = (result: { exited: boolean }) => {
          if (settled) return
          settled = true
          waitingOnProgress.delete(restartSilence)
          if (silenceTimer) clearTimeout(silenceTimer)
          resolve(result)
        }
        const restartSilence = () => {
          if (settled) return
          if (silenceTimer) clearTimeout(silenceTimer)
          silenceTimer = setTimeout(() => {
            logger.warn('child has gone silent without exiting — terminating it', { pid: child.pid, idleMs })
            terminate()
            finish({ exited: false })
          }, idleMs)
          silenceTimer.unref()
        }
        waitingOnProgress.add(restartSilence)
        // An exit settles this whichever way it went: a spawn error means there is no child to wait for.
        exitPromise.then(() => finish({ exited: true }), () => finish({ exited: true }))
        restartSilence()
      })
    },
    kill(signal: NodeJS.Signals = 'SIGTERM'): void {
      terminate(signal)
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
