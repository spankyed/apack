import { createClaudeUiControls, type ClaudeUiControls } from './ui-controls.ts'
import { createBackgroundTaskTracker } from './background-tasks.ts'
import { createHookRegistry } from './hooks.ts'
/**
 * High-level streaming conversation API.
 *
 * `query()` spawns `claude -p` in stream-json mode, drives the control loop,
 * and exposes two things to the caller:
 *
 *   - an async iterable of parsed stream events (everything except the
 *     control-request traffic, which is handled internally)
 *   - a `result` promise that resolves with the final normalised result
 *
 * Two modes, picked by whether an initial `prompt` is provided:
 *
 *  1. **Single-turn (default)**: pass `{ prompt }`. The wrapper writes the
 *     turn, immediately EOFs stdin, and the CLI runs once + exits. Drain
 *     `handle.events` in a `for await` and then `await handle.result`.
 *     No cleanup needed — the child unwinds itself.
 *
 *  2. **Multi-turn (opt-in)**: pass `{ keepStdinOpen: true, prompt }` OR
 *     pass no prompt. The wrapper leaves stdin open; the caller drives
 *     follow-up turns via `handle.send(text)` and MUST call `handle.close()`
 *     when done. Forgetting to close hangs the child until process exit.
 *
 * The implementation uses a fan-out: the raw NDJSON stream from the child is
 * consumed once by an internal pump that (a) routes control requests to the
 * control router and (b) pushes everything else into an async queue the
 * public iterable reads from. This is the only way to share a single Readable
 * between "internal logic" and "caller" without races.
 */

import { createLogger } from '@apackdev/sdk/logger'
import { argsFromOptions } from './args.ts'
import { PermissionModeSchema, type PermissionMode } from './types.ts'
import { z } from 'zod'
import { createControlRouter } from './control.ts'
import { createHostControls, ClaudeInitializationSchema, ClaudeContextUsageSchema, ClaudeInterruptReceiptSchema, ClaudeMcpStatusSchema, ClaudeFileRewindSchema, ClaudePlanSchema } from './host-controls.ts'
import type { ClaudeInitialization, ClaudeContextUsage, ClaudeInterruptReceipt, ClaudeMcpStatus, ClaudeFileRewind, ClaudePlan } from './host-controls.ts'
import {
  ClaudeAbortError,
  type ClaudeCodeError,
  ClaudeExitError,
  ClaudeProtocolError,
  ClaudeResultError,
} from './errors.ts'
import * as runner from './runner.ts'
import type { StreamHandle } from './runner.ts'

const logger = createLogger('claude-code-query')
import type {
  KnownStreamLine,
  ControlRequestLine,
  QueryOptions,
  QueryResult,
  ResultLine,
  StreamLine,
  UserInputMessage,
} from './types.ts'

export interface QueryHandle {
  /** Structured native UI controls; requires initialized ui_surface_v1 capability. */
  readonly ui: ClaudeUiControls
  /** Native commands, models and capabilities, available before a model turn. */
  readonly initialized: Promise<ClaudeInitialization>
  /** Explicit dryRun is required: preview and mutation have different effects. */
  rewindFiles(userMessageId: string, options: { dryRun: boolean }): Promise<ClaudeFileRewind>
  /** Resolves with the session id as soon as the CLI emits `system/init`. */
  readonly sessionId: Promise<string>
  /** Every non-control stream line, in order, until the child exits. */
  readonly events: AsyncIterable<StreamLine>
  /** Pending native task state when this result was emitted, independent of later buffered events. */
  hasPendingBackgroundTasks(result: StreamLine): boolean
  /** Final normalised result. Rejects on error result or non-zero exit. */
  readonly result: Promise<QueryResult>
  /** Send another user turn. No-op after close(). */
  send(text: string | UserInputMessage): void
  /**
   * Send a control_response back to the CLI for a surfaced control_request.
   * Only meaningful when `surfaceControlRequests: true` — in callback mode
   * the router handles responses internally.
   *
   * For a `can_use_tool` request the CLI parses this against a Zod union, and both branches have a
   * required field: `allow` needs `updatedInput` (an empty object means "run with the original input",
   * but the key must be there) and `deny` needs `message`. Both are optional in the signature below
   * because one `respond` serves every control request, so nothing here enforces it.
   *
   * Sending `{ behavior: 'allow' }` with no `updatedInput` does not fail loudly: the CLI's parse throws,
   * its own try/catch turns that into `{ behavior: 'deny', message: 'Tool permission request failed:
   * ZodError: …' }`, and every approved Write, Bash and Edit comes back as a red error on the
   * tool-activity row having never run. That happened once and took a while to find.
   */
  respond(requestId: string, response: { behavior: 'allow' | 'deny'; message?: string; updatedInput?: unknown }): void
  /** Cancel the current turn and await its native acknowledgement; optionally cancel queued inputs. */
  interrupt(options?: { cancelQueued?: boolean }): Promise<ClaudeInterruptReceipt>
  /** Rename the native session; an explicit ID protects against renaming a different session. */
  renameSession(title: string, sessionId?: string): Promise<void>
  /** Read the current native plan without a model turn. */
  getPlan(): Promise<ClaudePlan>
  /** Read live MCP server and tool status without a model turn. */
  getMcpStatus(): Promise<ClaudeMcpStatus>
  /** Read structured context usage; summary avoids per-category token-count API calls. */
  getContextUsage(): Promise<ClaudeContextUsage>
  /** Change the running CLI policy and return its acknowledged permission mode. */
  setPermissionMode(mode: PermissionMode): Promise<PermissionMode>
  /** Close stdin and wait for the child to exit. */
  close(): Promise<void>
  /** Force-terminate the child process. */
  kill(): void
}

/**
 * Start a streaming Claude Code conversation.
 *
 * Resolves once the child has been spawned — the async iterable and promises
 * on the returned handle drive the rest of the lifecycle.
 */
export async function query(opts: QueryOptions): Promise<QueryHandle> {
  const hooks = createHookRegistry(opts.hooks)
  const args = argsFromOptions(opts)
  const stream = await runner.spawnStream(args, {
    cwd: opts.cwd,
    env: opts.env,
    signal: opts.signal,
    cliPath: opts.cliPath,
  })

  const router = createControlRouter({
    onPermissionRequest: opts.onPermissionRequest,
    onControlRequest: request => request.subtype === 'hook_callback' && hooks.callbackIds.has(String(request.callback_id))
      ? hooks.handle(request)
      : opts.onControlRequest ? opts.onControlRequest(request) : Promise.reject(new Error(`Unhandled control request ${request.subtype}`)),
  })

  // ─── Fan-out plumbing ─────────────────────────────────────────────────────

  const eventQueue = new AsyncQueue<StreamLine>()
  const sessionId = deferred<string>()
  const resultPromise = deferred<QueryResult>()

  // Attach no-op catches immediately so Node doesn't treat a rejection that
  // lands before the caller's `await` as an unhandled rejection. The caller's
  // later `await handle.result` / `await handle.sessionId` still observes the
  // error — attaching a handler doesn't consume it for other awaiters.
  sessionId.promise.catch(() => {})
  resultPromise.promise.catch(() => {})

  // Pump: single reader over the child's NDJSON stream. Runs until the
  // generator completes (child exited). It never rejects on its own: the
  // `stream.done()` handler below is the single source of truth for
  // "what happened at child exit".
  const surfaceControlRequests = opts.surfaceControlRequests ?? false
  const backgroundTasks = createBackgroundTaskTracker()
  const hostControls = createHostControls(value => stream.write(value))
  const pumpPromise = pump(stream, router, eventQueue, sessionId, resultPromise, surfaceControlRequests, hostControls, hooks.callbackIds, backgroundTasks)
    .catch(err => {
      hostControls.close(err)
      sessionId.reject(err)
      resultPromise.reject(err)
      eventQueue.fail(err)
    })

  // Verified against pinned 2.1.299/2.1.300 binaries: initialization returns native metadata
  // without a user prompt. Route the response independently from the public event consumer.
  const initialized = hostControls.request({ subtype: 'initialize', hooks: hooks.registrations })
    .then(value => ClaudeInitializationSchema.parse(value))
  initialized.catch(() => {})
  logger.debug('initialize control_request sent')

  // Push the initial user turn, if any.
  //
  // Stdin lifecycle: stdin stays open through the turn and closes only once the result promise
  // settles — which is when the pump has seen the terminal `result` line. Both halves matter.
  //
  // Closing it earlier, synchronously after `writeUserTurn`, breaks the stdio permission flow,
  // which is bidirectional: the CLI emits `can_use_tool` control_requests on stdout and expects a
  // `control_response` back on stdin. With stdin already EOF'd, either (a) the response-writes
  // silently no-op through the `if (!child.stdin.writable) return` guard in runner.ts and the CLI
  // waits forever for a response, or (b) the CLI detects stdin EOF *before* emitting the
  // control_request and short-circuits to its non-interactive fallback (prose "please approve in
  // your terminal"), never emitting `can_use_tool` at all. Either way the tools sit in a running
  // state with no approval block visible.
  //
  // Not closing it at all deadlocks the other way: `--print` mode keeps waiting for more stdin
  // after emitting its `result` line. Closing on settle gives the CLI stdin EOF alongside a result
  // it has already emitted, and it exits cleanly.
  //
  // `.then(autoClose, autoClose)` is deliberate: we close stdin on both
  // resolve and reject so aborts, parse errors, and child-crash rejections
  // still flush EOF cleanly. `stream.endInput()` is already idempotent
  // (runner.ts guards on `child.stdin.writable`) and wrapped in try/catch
  // as extra belt-and-suspenders for the "child already gone" edge case.
  //
  // Multi-turn callers (`keepStdinOpen: true`) bypass this entirely and
  // own the close lifecycle via `handle.close()`.
  if (opts.prompt !== undefined) {
    writeUserTurn(stream, opts.prompt)
    if (!opts.keepStdinOpen && !surfaceControlRequests) {
      const autoClose = () => {
        hostControls.close()
        try { stream.endInput() } catch { /* already closed or child gone */ }
      }
      resultPromise.promise.then(autoClose, autoClose)
    }
  }

  // Wire child exit into the result promise. This is the single place that
  // decides "did the query complete successfully?" after the child exits —
  // `finaliseNoResult` classifies the exit state with full stderr context.
  stream.done().then(async ({ exitCode, signal, stderr }) => {
    // Drain pump before deciding final state — avoids racing stdout 'end'
    // (which finishes pump) against child 'close' (which fires stream.done).
    await pumpPromise
    hostControls.close()
    eventQueue.close()

    if (resultPromise.settled) return

    const err = finaliseNoResult(
      { exitCode, signal, stderr },
      args,
      opts.signal,
    )
    sessionId.reject(err)
    resultPromise.reject(err)
  }).catch(err => {
    hostControls.close(err)
    // Defensive: stream.done() itself shouldn't throw, but if it does, route
    // the error into the same rejection channels so nothing is left dangling.
    sessionId.reject(err)
    resultPromise.reject(err)
    eventQueue.fail(err)
  })

  // ─── Public handle ────────────────────────────────────────────────────────

  return {
    ui: createClaudeUiControls(initialized, hostControls),
    initialized,
    sessionId: sessionId.promise,
    events: eventQueue,
    hasPendingBackgroundTasks: result => backgroundTasks.hasPendingTasks(result),
    result: resultPromise.promise,

    send(text: string | UserInputMessage): void {
      writeUserTurn(stream, text)
    },

    respond(requestId: string, response: { behavior: 'allow' | 'deny'; message?: string; updatedInput?: unknown }): void {
      if (!stream.write({
        type: 'control_response',
        response: { subtype: 'success', request_id: requestId, response },
      })) throw new ClaudeProtocolError('could not send control response: stdin is closed')
    },

    async interrupt(options: { cancelQueued?: boolean } = {}): Promise<ClaudeInterruptReceipt> {
      const valid = z.object({ cancelQueued: z.boolean().optional() }).strict().parse(options)
      await initialized
      return ClaudeInterruptReceiptSchema.parse(await hostControls.request({
        subtype: 'interrupt',
        ...(valid.cancelQueued === undefined ? {} : { cancel_queued: valid.cancelQueued }),
      }))
    },

    async renameSession(title: string, sessionId?: string): Promise<void> {
      const validTitle = z.string().trim().min(1).parse(title)
      await initialized
      await hostControls.request({ subtype: 'rename_session', title: validTitle, source: 'host',
        ...(sessionId === undefined ? {} : { session_id: sessionId }) })
    },

    async rewindFiles(userMessageId: string, options: { dryRun: boolean }): Promise<ClaudeFileRewind> {
      const id = z.string().trim().min(1).parse(userMessageId)
      const valid = z.object({ dryRun: z.boolean() }).strict().parse(options)
      await initialized
      return ClaudeFileRewindSchema.parse(await hostControls.request({subtype: 'rewind_files', user_message_id: id, dry_run: valid.dryRun}))
    },

    async getPlan(): Promise<ClaudePlan> {
      await initialized
      return ClaudePlanSchema.parse(await hostControls.request({ subtype: 'get_plan' }))
    },

    async getMcpStatus(): Promise<ClaudeMcpStatus> {
      await initialized
      return ClaudeMcpStatusSchema.parse(await hostControls.request({ subtype: 'mcp_status' }))
    },

    async getContextUsage(): Promise<ClaudeContextUsage> {
      await initialized
      return ClaudeContextUsageSchema.parse(await hostControls.request({ subtype: 'get_context_usage', detail: 'summary' }))
    },

    async setPermissionMode(mode: PermissionMode): Promise<PermissionMode> {
      const validMode = PermissionModeSchema.parse(mode)
      await initialized
      const response = await hostControls.request({ subtype: 'set_permission_mode', mode: validMode })
      return z.object({ mode: PermissionModeSchema }).parse(response).mode
    },

    async close(): Promise<void> {
      hostControls.close()
      stream.endInput()
      await stream.done()
      await pumpPromise
    },

    kill(): void {
      hostControls.close()
      stream.kill('SIGTERM')
    },
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

/** Normalise a caller-supplied turn to the NDJSON user-message shape. */
function writeUserTurn(stream: StreamHandle, turn: string | UserInputMessage): void {
  if (typeof turn === 'string') {
    stream.write({
      type: 'user',
      message: { role: 'user', content: turn },
      parent_tool_use_id: null,
    } satisfies UserInputMessage)
    return
  }
  stream.write(turn)
}

/**
 * Drain the child's NDJSON stream, dispatching control requests, forwarding
 * everything else to the event queue, and resolving sessionId / result at
 * the appropriate moments.
 *
 * Uses a discriminator switch on `KnownStreamLine` so narrowing is exhaustive
 * without casts. Any `line.type` value not in the known set falls through to
 * the default branch and is forwarded to the queue as an `UnknownLine` — the
 * CLI can add new types without crashing the pump.
 */
async function pump(
  stream: StreamHandle,
  router: ReturnType<typeof createControlRouter>,
  eventQueue: AsyncQueue<StreamLine>,
  sessionId: Deferred<string>,
  resultPromise: Deferred<QueryResult>,
  surfaceControlRequests: boolean,
  hostControls: ReturnType<typeof createHostControls>,
  hookCallbackIds: ReadonlySet<string>,
  backgroundTasks: ReturnType<typeof createBackgroundTaskTracker>,
): Promise<void> {
  const pendingCallbacks = new Set<string>()
  let reading = true
  function dispatchControl(line: ControlRequestLine): void {
    if (pendingCallbacks.has(line.request_id)) return
    pendingCallbacks.add(line.request_id)
    // A user decision can wait indefinitely. Keep reading control responses and cancellation
    // while it waits, and suppress its eventual response if the CLI withdrew it or exited.
    void router.handle(line).then(response => {
      if (reading && pendingCallbacks.delete(line.request_id)) stream.write(response)
    }).catch(error => {
      pendingCallbacks.delete(line.request_id)
      if (!reading) return
      hostControls.close(error)
      sessionId.reject(error)
      resultPromise.reject(error)
      eventQueue.fail(error)
    })
  }
  try {
    for await (const decoded of stream.lines) {
      if (!decoded.ok) {
        // Keep the conversation alive on a single malformed line — emit a
        // protocol error event that callers can observe if they want to.
        eventQueue.push({
          type: '__parse_error',
          raw: decoded.raw,
          error: decoded.error.message,
        } as StreamLine)
        continue
      }

      const line = decoded.value as KnownStreamLine
      backgroundTasks.observe(line)

      switch (line.type) {
        case 'control_request': {
          const req = (line as unknown as { request?: { subtype?: string }; request_id?: string })
          logger.debug('control_request received', {
            subtype: req.request?.subtype,
            request_id: req.request_id,
            surfaced: surfaceControlRequests,
          })
          if (surfaceControlRequests && req.request?.subtype !== 'initialize'
            && !(line.request.subtype === 'hook_callback' && hookCallbackIds.has(String(line.request.callback_id)))) {
            // Push to the event queue so the consumer handles it inline via
            // handle.respond(). The pump does NOT await a callback — the CLI
            // blocks on its own until it receives the control_response, so the
            // consumer's for-await naturally pauses on the next iteration.
            // `initialize` is always handled internally — it's a handshake,
            // not a user-facing permission prompt.
            break // fall through to eventQueue.push below
          }
          // The caller isn't surfacing control requests, so the router answers this one.
          dispatchControl(line)
          continue
        }

        case 'control_cancel_request':
          pendingCallbacks.delete(line.request_id)
          if (surfaceControlRequests) break // surface to consumer
          continue

        case 'control_response':
          hostControls.receive(line)
          continue

        case 'keep_alive':
          // Swallowed — not interesting to the public event iterator.
          continue

        case 'system':
          // First `system/init` gives us the session id. Resolve once.
          if (line.subtype === 'init' && line.session_id && !sessionId.settled) {
            sessionId.resolve(line.session_id)
          }
          break

        case 'result':
          handleResult(line, resultPromise)
          break

        default:
          // user / assistant / stream_event / tool_progress / rate_limit_event
          // / tool_use_summary / unknown passthrough. Nothing special to do;
          // fall through to the queue push below.
          break
      }

      eventQueue.push(line)
    }

  } finally {
    reading = false
    pendingCallbacks.clear()
  }

  // Note: we intentionally do NOT reject the result promise here. The
  // `stream.done()` handler in `query()` is the single source of truth for
  // "stream ended" — it has access to exit code, signal, and stderr, so it
  // can produce a richer error than pump can from inside the read loop.
}

/**
 * Decide what happened when the child exits WITHOUT having emitted a
 * `{type:'result'}` line. Classifies the exit state and produces a typed
 * error suitable for rejecting `sessionId` / `resultPromise`.
 *
 * Exported for tests.
 */
export function finaliseNoResult(
  exitInfo: { exitCode: number; signal: NodeJS.Signals | null; stderr: string },
  args: readonly string[],
  abortSignal: AbortSignal | undefined,
): ClaudeCodeError {
  if (abortSignal?.aborted) {
    return new ClaudeAbortError(abortSignal.reason)
  }
  if (exitInfo.exitCode !== 0) {
    return new ClaudeExitError(exitInfo.exitCode, exitInfo.signal, exitInfo.stderr, args)
  }
  // Clean exit but no result line — legitimate CLI behaviour for some
  // control_request paths (e.g. `end_session`), but still an error from the
  // caller's perspective. Include stderr tail so future occurrences are
  // actually diagnosable.
  const tail = exitInfo.stderr ? exitInfo.stderr.trim().slice(-500) : ''
  return new ClaudeProtocolError(
    `child stream ended without a result line${tail ? `: ${tail}` : ''}`,
  )
}

/**
 * Known `result.subtype` values from the leaked Claude Code source —
 * `src/entrypoints/sdk/coreSchemas.ts`. Anything outside this set is a
 * protocol violation and the caller should know about it rather than
 * silently resolving with empty text.
 */
const KNOWN_RESULT_SUBTYPES = new Set<string>([
  'success',
  'error_during_execution',
  'error_max_turns',
  'error_max_budget_usd',
  'error_max_structured_output_retries',
])

function handleResult(raw: ResultLine, resultPromise: Deferred<QueryResult>): void {
  if (resultPromise.settled) return

  if (!KNOWN_RESULT_SUBTYPES.has(raw.subtype)) {
    resultPromise.reject(
      new ClaudeProtocolError(`unknown result subtype "${raw.subtype}"`),
    )
    return
  }

  if (raw.subtype === 'success') {
    resultPromise.resolve(normaliseResult(raw))
    return
  }

  resultPromise.reject(
    new ClaudeResultError(raw.subtype, raw.errors ?? [], raw.session_id),
  )
}

/**
 * Sum per-model costUSD from the CLI's modelUsage map.
 * Falls back to 0 when the field is absent or malformed.
 */
function sumModelUsageCost(modelUsage: Record<string, any> | undefined): number {
  if (!modelUsage || typeof modelUsage !== 'object') return 0
  let total = 0
  for (const entry of Object.values(modelUsage)) {
    if (entry && typeof entry.costUSD === 'number') total += entry.costUSD
  }
  return total
}

function normaliseResult(raw: ResultLine): QueryResult {
  return {
    sessionId: raw.session_id ?? '',
    text: raw.result ?? '',
    durationMs: raw.duration_ms ?? 0,
    numTurns: raw.num_turns ?? 0,
    totalCostUsd: raw.total_cost_usd || sumModelUsageCost(raw.modelUsage as Record<string, any> | undefined),
    usage: raw.usage as Record<string, unknown> | undefined,
    structuredOutput: raw.structured_output,
    permissionDenials: (raw.permission_denials ?? []) as Array<Record<string, unknown>>,
    raw,
  }
}

// ─── Tiny async primitives ───────────────────────────────────────────────────

/** A promise with externally-callable resolve/reject + a `settled` flag. */
interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
  readonly settled: boolean
}

function deferred<T>(): Deferred<T> {
  let resolveFn!: (v: T) => void
  let rejectFn!: (r: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolveFn = res; rejectFn = rej })
  const box = {
    promise,
    settled: false,
    resolve(value: T) {
      if (box.settled) return
      box.settled = true
      resolveFn(value)
    },
    reject(reason: unknown) {
      if (box.settled) return
      box.settled = true
      rejectFn(reason)
    },
  }
  return box
}

/**
 * Single-producer, single-consumer async queue usable as AsyncIterable.
 *
 * Backed by a ring of resolved values + a waiters queue. Producers call
 * `push` / `close` / `fail`. Consumers iterate once via `for await`.
 */
class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = []
  private closed = false
  private failure: unknown = null

  push(value: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value, done: false })
    else this.values.push(value)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length) {
      this.waiters.shift()!({ value: undefined as unknown as T, done: true })
    }
  }

  fail(err: unknown): void {
    if (!this.failure) this.failure = err
    this.close()
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.failure) return Promise.reject(this.failure)
        if (this.values.length) {
          return Promise.resolve({ value: this.values.shift()!, done: false })
        }
        if (this.closed) return Promise.resolve({ value: undefined as unknown as T, done: true })
        return new Promise<IteratorResult<T>>(resolve => this.waiters.push(resolve))
      },
      return: () => Promise.resolve({ value: undefined as unknown as T, done: true }),
    }
  }
}
