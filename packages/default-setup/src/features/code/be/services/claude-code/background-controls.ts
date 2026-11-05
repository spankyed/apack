import { z } from 'zod'
import type { ClaudeTerminalUiTransport } from './terminal-ui.ts'
import { ClaudeNativeQuestionDialogSchema, ClaudeNativeBashDialogSchema, ClaudeNativeFileDialogSchema, ClaudeNativeWorkflowDialogSchema, ClaudeNativePlanDialogSchema, ClaudeNativeToolPermissionDialogSchema, ClaudeNativeGenericToolPermissionDialogSchema } from './terminal-dialogs.ts'

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
  let closed = false, reading = false
  let control: ClaudeBackgroundControl | undefined
  function replace(next: ClaudeBackgroundControl | undefined) {
    if (JSON.stringify(control) === JSON.stringify(next)) return
    control = next
    options.changed()
    for (const listener of listeners) { try { listener() } catch { /* Isolate presentation clients. */ } }
  }
  async function refresh() {
    if (closed || reading) return
    const readEpoch = epoch
    reading = true
    try {
      const result = await options.transport.request({ subtype: 'apack_pending_control' }) as { control?: unknown }
      if (closed || readEpoch !== epoch) return
      const next = result.control === null ? undefined : ClaudeBackgroundControlSchema.parse(result.control)
      if (next && next.dialog.sessionId !== options.sessionId) throw new Error('Background control owner changed')
      replace(next)
    } catch {
      // A failed read cannot leave an actionable stale card in any window.
      if (!closed && readEpoch === epoch) replace(undefined)
    } finally { reading = false }
  }
  const timer = setInterval(() => { void refresh() }, 1000)
  timer.unref()
  void refresh()
  return {
    get value() { return closed ? undefined : control },
    refresh,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    settled(id: string, revision: string) { if (control?.dialog.id === id && control.dialog.revision === revision) { epoch++; replace(undefined) } },
    close() { closed = true; clearInterval(timer); control = undefined; listeners.clear() },
  }
}
