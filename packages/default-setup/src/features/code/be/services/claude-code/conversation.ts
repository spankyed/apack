import { ClaudeProtocolError, ClaudeResultError } from './errors.ts'
import { normaliseResult, type QueryHandle } from './query.ts'
import type { QueryResult, ResultLine, StreamLine, UserInputMessage } from './types.ts'

export interface ClaudeConversationTurn {
  handle: QueryHandle
  inputId?: string
  /** Explicit teardown won before or during consumption; never register new app ownership. */
  stopped: boolean
  /** Native process cost already accounted for before this turn. */
  costBaseline: number
}
export type ClaudeTurnConsumer = (turn: ClaudeConversationTurn) => Promise<void>
export interface ClaudeConversation {
  readonly handle: QueryHandle
  readonly busy: boolean
  readonly closing: boolean
  readonly sessionId?: string
  readonly sessionCwd?: string
  readonly done: Promise<void>
  start(input: string | UserInputMessage, consume: ClaudeTurnConsumer): string
  release(handle: QueryHandle): boolean
  ownsTurn(handle: QueryHandle): boolean
  subscribe(listener: (event: StreamLine) => void): () => void
  close(): Promise<void>
  kill(): void
}

class ConversationQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private waiting?: { resolve(value: IteratorResult<T>): void; reject(error: unknown): void }
  private ended = false
  private error?: unknown
  push(value: T): void {
    if (this.ended) return
    if (this.waiting) { this.waiting.resolve({ value, done: false }); this.waiting = undefined }
    else {
      if (this.values.length >= 4096) throw new ClaudeProtocolError('conversation turn event queue exceeded its limit')
      this.values.push(value)
    }
  }
  close(error?: unknown): void {
    this.ended = true
    this.error = error
    if (this.waiting) {
      if (error) this.waiting.reject(error)
      else this.waiting.resolve({ value: undefined as T, done: true })
      this.waiting = undefined
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => {
      if (this.error) return Promise.reject(this.error)
      if (this.values.length) return Promise.resolve({ value: this.values.shift()!, done: false })
      if (this.ended) return Promise.resolve({ value: undefined as T, done: true })
      if (this.waiting) return Promise.reject(new ClaudeProtocolError('a conversation turn has one event consumer'))
      return new Promise((resolve, reject) => { this.waiting = { resolve, reject } })
    }, return: async () => ({ value: undefined as T, done: true }) }
  }
}

/** One reader for the process lifetime; an ordinary result ends only its turn. */
export function createClaudeConversation(native: QueryHandle, consumeAutonomous: ClaudeTurnConsumer): ClaudeConversation {
  type ActiveTurn = { turn: ClaudeConversationTurn; queue: ConversationQueue<StreamLine>; consumed: Promise<void>; terminal: boolean; resolve(result: QueryResult): void; reject(error: unknown): void }
  let active: ActiveTurn | undefined
  let pending: { inputId: string; consume: ClaudeTurnConsumer } | undefined
  let closing = false
  let exited = false
  let stopped = false
  let sessionId: string | undefined
  let sessionCwd: string | undefined
  let cumulativeCost = 0
  let consumerFailure: unknown
  const listeners = new Set<(event: StreamLine) => void>()

  function activate(consume: ClaudeTurnConsumer, inputId?: string): ActiveTurn {
    const queue = new ConversationQueue<StreamLine>()
    let resolve!: (result: QueryResult) => void
    let reject!: (error: unknown) => void
    const result = new Promise<QueryResult>((yes, no) => { resolve = yes; reject = no })
    result.catch(() => {})
    const turn = { handle: { ...native, events: queue, result }, inputId, stopped, costBaseline: cumulativeCost }
    const current: ActiveTurn = { turn, queue, resolve, reject, terminal: false, consumed: Promise.resolve() }
    active = current
    current.consumed = Promise.resolve().then(() => consume(turn)).catch(error => {
      consumerFailure = error
      closing = true
      native.kill()
      throw error
    })
    current.consumed.catch(() => {})
    return current
  }

  const done = (async () => {
    let failure: unknown
    try {
      for await (const event of native.events) {
        const line = event as Record<string, unknown>
        if (line.type === 'system' && line.subtype === 'init') {
          if (typeof line.session_id === 'string' && line.session_id) sessionId = line.session_id
          if (typeof line.cwd === 'string' && line.cwd) sessionCwd = line.cwd
        }
        if (pending && line.type === 'command_lifecycle' && line.command_uuid === pending.inputId && line.state === 'started') {
          if (active) throw new ClaudeProtocolError('native inputs overlapped before the prior turn completed')
          activate(pending.consume, pending.inputId)
          pending = undefined
        }
        if (pending && line.type === 'command_lifecycle' && line.command_uuid === pending.inputId
          && ['cancelled', 'discarded', 'refused'].includes(String(line.state))) {
          if (active) throw new ClaudeProtocolError('pending input ended while another turn was active')
          const rejected = activate(pending.consume, pending.inputId)
          pending = undefined
          const error = new ClaudeProtocolError(`native input ${String(line.state)} before starting`)
          rejected.reject(error)
          rejected.queue.close(error)
          await rejected.consumed
          if (active === rejected) active = undefined
          for (const listener of listeners) { try { listener(event) } catch { /* isolate observers */ } }
          continue
        }
        if (!active && (line.type === 'assistant' || line.type === 'result'
          || line.type === 'stream_event' || line.type === 'control_request')) activate(consumeAutonomous)
        for (const listener of listeners) { try { listener(event) } catch { /* an observer cannot stop the conversation */ } }
        const current = active
        if (!current) continue
        if (line.type !== 'result') { current.queue.push(event); continue }
        const raw = event as ResultLine
        if (current.turn.inputId && raw.user_message_uuid && raw.user_message_uuid !== current.turn.inputId) {
          throw new ClaudeProtocolError('native result belongs to a different input')
        }
        current.queue.push(event)
        const normalized = normaliseResult(raw)
        cumulativeCost = Math.max(cumulativeCost, normalized.totalCostUsd)
        if (raw.subtype === 'success') current.resolve(normalized)
        else current.reject(new ClaudeResultError(raw.subtype, raw.errors ?? [], raw.session_id))
        if (raw.subtype === 'success' && native.hasPendingBackgroundTasks(event)) continue
        current.terminal = true
        current.queue.close()
        await current.consumed
        if (active === current) active = undefined
      }
    } catch (error) { failure = error; native.kill() }
    finally {
      failure ??= consumerFailure
      exited = true
      closing = true
      while (active || pending) {
        if (!active && pending) { activate(pending.consume, pending.inputId); pending = undefined }
        const current = active
        if (!current) break
        const error = failure ?? new ClaudeProtocolError('conversation exited before the turn completed')
        current.reject(error)
        current.queue.close(error)
        await current.consumed.catch(() => {})
        if (active === current) active = undefined
      }
      listeners.clear()
    }
    if (failure) throw failure
  })()
  done.catch(() => {})

  return {
    handle: native,
    get busy() { return active !== undefined || pending !== undefined },
    get closing() { return closing || exited },
    get sessionId() { return sessionId },
    get sessionCwd() { return sessionCwd },
    done,
    start(input, consume) {
      if (closing || exited) throw new ClaudeProtocolError('conversation is closed')
      if (active || pending) throw new ClaudeProtocolError('conversation already has an active input')
      const inputId = native.send(input)
      pending = { consume, inputId }
      return inputId
    },
    ownsTurn(handle) { return active?.turn.handle === handle },
    release(handle) {
      if (active?.turn.handle !== handle) return false
      if (!active.terminal) {
        const error = new ClaudeProtocolError('conversation turn was stopped before completion')
        stopped = true
        active.turn.stopped = true
        closing = true
        active.reject(error)
        active.queue.close(error)
        native.kill()
      } else active.queue.close()
      active = undefined
      return true
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async close() {
      closing = true
      await native.close()
      await done
    },
    kill() { stopped = true; if (active) active.turn.stopped = true; closing = true; native.kill() },
  }
}
