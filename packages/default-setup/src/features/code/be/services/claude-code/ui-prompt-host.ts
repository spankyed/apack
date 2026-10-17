import { z } from 'zod'
import type { ControlRequestLine } from './types.ts'

const box = z.object({ text: z.string().max(1000000), cursor: z.number().int().nonnegative() }).strict()
  .refine(value => value.cursor <= value.text.length, 'cursor exceeds prompt text')
const decoration = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
  color: z.string().optional(), backgroundColor: z.string().optional(), dimColor: z.boolean().optional(),
  bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), strikethrough: z.boolean().optional(),
}).strict()
const fill = z.object({ text: z.string().max(1000000), mode: z.enum(['replace', 'append', 'insert']), decorations: z.array(decoration).max(8192).optional() }).strict()
  .superRefine((value, context) => {
    let end = 0
    for (const run of value.decorations ?? []) {
      if (run.start < end || run.end <= run.start || run.end > value.text.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid prompt fill decoration range' })
      end = run.end
    }
  })
const request = z.object({ subtype: z.enum(['ui_prompt_read', 'ui_prompt_fill']), client_id: z.string(), surface: z.enum(['desktop', 'mobile', 'vscode']) }).passthrough()
export type ClaudePromptHostBox = z.infer<typeof box>
export type ClaudePromptHostFill = z.infer<typeof fill>
export interface ClaudePromptHost {
  read(signal: AbortSignal, expiresAt: number): Promise<ClaudePromptHostBox | undefined>
  fill(input: ClaudePromptHostFill, signal: AbortSignal, expiresAt: number): Promise<boolean>
}

/** Process-local reverse UI requests. These never enter a conversation turn or permission queue. */
export function createClaudePromptHosts(write: (value: unknown) => boolean) {
  const hosts = new Map<string, ClaudePromptHost>()
  const pending = new Map<string, { client: string; abort: AbortController; finish(value?: unknown, writeReply?: boolean): void }>()
  // Never reapply a duplicate fill. Once the session budget is exhausted, refuse new host work.
  const seen = new Set<string>()
  let closed = false
  function detach(client: string) {
    hosts.delete(client)
    for (const item of pending.values()) if (item.client === client) item.finish()
  }
  return {
    register(client: string, host: ClaudePromptHost): () => void {
      if (closed || hosts.has(client)) throw new Error('native composer host is unavailable or already registered')
      hosts.set(client, host)
      return () => { if (hosts.get(client) === host) detach(client) }
    },
    has: (client: string) => hosts.has(client),
    detach,
    receive(line: ControlRequestLine): boolean {
      if (!['ui_prompt_read', 'ui_prompt_fill'].includes(line.request.subtype)) return false
      if (closed || seen.has(line.request_id)) return true
      const read = line.request.subtype === 'ui_prompt_read', fallback = read ? { text: '', cursor: 0 } : { filled: false }
      const reply = (value: unknown) => {
        if (closed) return
        try { write({ type: 'control_response', response: { subtype: 'success', request_id: line.request_id, response: value } }) } catch { /* process transport already closed */ }
      }
      if (seen.size >= 4096 || pending.size >= 128) { reply(fallback); return true }
      seen.add(line.request_id)
      const parsed = request.safeParse(line.request)
      const host = parsed.success && parsed.data.surface === 'desktop' ? hosts.get(parsed.data.client_id) : undefined
      const input = read ? undefined : fill.safeParse({ text: line.request.text, mode: line.request.mode, ...(line.request.decorations !== undefined ? { decorations: line.request.decorations } : {}) })
      const fillInput = input?.success ? input.data : undefined
      if (!host || (!read && !fillInput)) { reply(fallback); return true }
      const expiresAt = Date.now() + 3500
      const abort = new AbortController()
      const timer = setTimeout(() => finish(), 4000)
      timer.unref()
      function finish(value: unknown = fallback, writeReply = true) {
        if (!pending.delete(line.request_id)) return
        clearTimeout(timer); abort.abort()
        if (writeReply) reply(value)
      }
      pending.set(line.request_id, { client: parsed.success ? parsed.data.client_id : '', abort, finish })
      void Promise.resolve().then<unknown>(() => {
        if (abort.signal.aborted) return undefined
        return read ? host.read(abort.signal, expiresAt) : host.fill(fillInput!, abort.signal, expiresAt)
      }).then(value => {
        if (read) { const valid = box.safeParse(value); finish(valid.success ? valid.data : fallback) }
        else finish({ filled: value === true })
      }, () => finish())
      return true
    },
    cancel(id: string): boolean {
      const item = pending.get(id)
      if (item) item.finish(undefined, false)
      return seen.has(id)
    },
    close(): void {
      closed = true
      for (const item of pending.values()) item.finish(undefined, false)
      hosts.clear()
    },
  }
}
