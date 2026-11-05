import { createLogger } from '@apackdev/sdk/logger'
import { z } from 'zod'
import type { ClaudeTerminalUiTransport } from './terminal-ui.ts'
import { ClaudeNativeQuestionDialogSchema, ClaudeNativeBashDialogSchema, ClaudeNativeFileDialogSchema, ClaudeNativeWorkflowDialogSchema, ClaudeNativePlanDialogSchema, ClaudeNativeToolPermissionDialogSchema, ClaudeNativeGenericToolPermissionDialogSchema } from './terminal-dialogs.ts'

const logger = createLogger('claude-background-controls')

export const ClaudeBackgroundControlSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('question'), dialog: ClaudeNativeQuestionDialogSchema}),
  z.object({kind: z.literal('bash'), dialog: ClaudeNativeBashDialogSchema}),
  z.object({kind: z.literal('file'), dialog: ClaudeNativeFileDialogSchema}),
  z.object({kind: z.literal('workflow'), dialog: ClaudeNativeWorkflowDialogSchema}),
  z.object({kind: z.literal('plan'), dialog: ClaudeNativePlanDialogSchema}),
  z.object({kind: z.literal('tool'), dialog: ClaudeNativeToolPermissionDialogSchema}),
  z.object({kind: z.literal('generic'), dialog: ClaudeNativeGenericToolPermissionDialogSchema}),
])
export type ClaudeBackgroundControl = z.infer<typeof ClaudeBackgroundControlSchema>
export type ClaudeBackgroundApproval = Exclude<ClaudeBackgroundControl, {kind: 'question'}>
export interface ClaudeBackgroundControls {
  readonly value: ClaudeBackgroundControl | undefined
  readonly turn: {id: string; cancelled: boolean} | undefined
  interrupt(turnId: string): Promise<{cancelled: boolean; ending?: boolean}>
  refresh(): Promise<void>
  subscribe(listener: () => void): () => void
  settled(id: string, revision: string): void
  close(): void
}

/** Observe the verified child once, independently of desktop clients and Reply visibility. */
export function createClaudeBackgroundControls(options: {
  sessionId: string
  transport: Pick<ClaudeTerminalUiTransport, 'request'>
  changed(): void
}): ClaudeBackgroundControls {
  const listeners = new Set<() => void>()
  let epoch = 0
  let reportedFailure = false
  let closed = false, reading = false
  let control: ClaudeBackgroundControl | undefined
  let turn: {id: string; cancelled: boolean} | undefined, interrupting = false
  const turnSchema = z.object({id: z.string().min(1).max(256), cancelled: z.boolean()})
  function replace(next: ClaudeBackgroundControl | undefined, nextTurn: typeof turn) {
    if (JSON.stringify([control, turn]) === JSON.stringify([next, nextTurn])) return
    control = next; turn = nextTurn
    options.changed()
    for (const listener of listeners) { try { listener() } catch { /* Isolate presentation clients. */ } }
  }
  async function refresh() {
    if (closed || reading) return
    const readEpoch = epoch
    reading = true
    try {
      const result = await options.transport.request({ subtype: 'apack_pending_control' }) as { control?: unknown; turn?: unknown }
      if (closed || readEpoch !== epoch) return
      const nextTurn = turnSchema.nullable().parse(result.turn) ?? undefined
      const next = nextTurn?.cancelled || result.control === null ? undefined : ClaudeBackgroundControlSchema.parse(result.control)
      if (next && next.dialog.sessionId !== options.sessionId) throw new Error('Background control owner changed')
      reportedFailure = false
      replace(next, nextTurn)
    } catch (error) {
      // A failed read cannot leave an actionable stale card in any window.
      if (!closed && readEpoch === epoch) {
        replace(undefined, undefined)
        if (!reportedFailure) {
          reportedFailure = true
          // A schema failure needs field paths, never the native prompt or submitted values.
          const problem = error instanceof z.ZodError ? error.issues.map(issue => ({path: issue.path, code: issue.code})) : error instanceof Error ? error.message.slice(0, 1000) : 'Unknown control read failure'
          logger.debug('Original child control read failed', {sessionId: options.sessionId, problem})
        }
      }
    } finally { reading = false }
  }
  const timer = setInterval(() => { void refresh() }, 1000)
  timer.unref()
  void refresh()
  return {
    get value() { return closed ? undefined : control },
    get turn() { return closed ? undefined : turn },
    async interrupt(turnId: string) {
      if (closed || interrupting || !turn || turn.id !== turnId || turn.cancelled) throw new Error('Original child turn changed or is already ending')
      interrupting = true
      try {
        const result = z.object({cancelled: z.boolean(), ending: z.boolean().optional()}).parse(await options.transport.request({subtype: 'apack_abort_turn', session_id: options.sessionId, turn_id: turnId}))
        if (closed) throw new Error('Original child owner retired before interruption completed')
        if (!result.cancelled && result.ending !== true) throw new Error('Original child interruption was not confirmed')
        // A late acknowledgement must not erase a newer turn's question.
        if (turn?.id === turnId) { epoch++; replace(undefined, {id: turnId, cancelled: true}) }
        return result
      } finally { interrupting = false }
    },
    refresh,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    settled(id: string, revision: string) { if (control?.dialog.id === id && control.dialog.revision === revision) { epoch++; replace(undefined, turn) } },
    close() { closed = true; clearInterval(timer); control = undefined; turn = undefined; listeners.clear() },
  }
}
