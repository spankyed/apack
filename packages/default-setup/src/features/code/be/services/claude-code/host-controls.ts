import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ClaudeProtocolError } from './errors.ts'

/** Metadata returned by the initialize exchange in Claude Code 2.1.299–2.1.301. */
export const ClaudeInitializationSchema = z.object({
  commands: z.array(z.object({ name: z.string(), description: z.string().optional() }).passthrough()),
  agents: z.array(z.object({ name: z.string() }).passthrough()),
  models: z.array(z.object({ value: z.string(), displayName: z.string() }).passthrough()),
  claude_code_version: z.string().optional(),
  current_permission_mode: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
}).passthrough()
export type ClaudeInitialization = z.infer<typeof ClaudeInitializationSchema>

export const ClaudeContextUsageSchema = z.object({
  model: z.string(),
  totalTokens: z.number().nonnegative(),
  maxTokens: z.number().positive(),
  percentage: z.number().nonnegative(),
  memoryFiles: z.array(z.object({
    path: z.string(), type: z.string(), tokens: z.number().nonnegative(),
  }).passthrough()),
  skills: z.object({ skillFrontmatter: z.array(z.object({
    name: z.string(), source: z.string(), tokens: z.number().nonnegative(),
  }).passthrough()) }).passthrough().optional(),
  categories: z.array(z.object({
    name: z.string(),
    tokens: z.number().nonnegative(),
    kind: z.string().optional(),
  }).passthrough()),
}).passthrough()
export type ClaudeContextUsage = z.infer<typeof ClaudeContextUsageSchema>

/** Native acknowledgement distinguishes cancelled inputs from inputs still queued. */
export const ClaudeInterruptReceiptSchema = z.object({
  still_queued: z.array(z.string()),
  cancelled: z.array(z.string()).optional(),
}).passthrough()
export type ClaudeInterruptReceipt = z.infer<typeof ClaudeInterruptReceiptSchema>

interface PendingControl {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/** Host-to-CLI requests are independent of CLI-to-host tool permission requests. */
export function createHostControls(write: (value: unknown) => boolean) {
  const pending = new Map<string, PendingControl>()
  let closed: Error | undefined

  function finish(id: string, response: { value: unknown } | { error: Error }): void {
    const waiter = pending.get(id)
    if (!waiter) return
    pending.delete(id)
    clearTimeout(waiter.timer)
    if ('error' in response) waiter.reject(response.error)
    else waiter.resolve(response.value)
  }

  return {
    request(request: Record<string, unknown> & { subtype: string }, timeoutMs = 10_000): Promise<unknown> {
      if (closed) return Promise.reject(closed)
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        return Promise.reject(new ClaudeProtocolError('control timeout must be a positive integer'))
      }
      if (pending.size >= 128) return Promise.reject(new ClaudeProtocolError('too many pending control requests'))
      const id = randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(id, {
          error: new ClaudeProtocolError(`control request ${request.subtype} timed out after ${timeoutMs}ms`),
        }), timeoutMs)
        timer.unref()
        pending.set(id, { resolve, reject, timer })
        try {
          if (!write({ type: 'control_request', request_id: id, request })) {
            finish(id, { error: new ClaudeProtocolError(`could not send control request ${request.subtype}`) })
          }
        } catch (error) {
          finish(id, { error: error instanceof Error ? error : new Error(String(error)) })
        }
      })
    },

    receive(value: unknown): void {
      const parsed = z.object({ response: z.object({
        request_id: z.string(), subtype: z.enum(['success', 'error']),
        response: z.unknown().optional(), error: z.string().optional(),
      }) }).safeParse(value)
      if (!parsed.success) return
      const response = parsed.data.response
      finish(response.request_id, response.subtype === 'error'
        ? { error: new ClaudeProtocolError(response.error ?? 'control request rejected') }
        : { value: response.response })
    },

    close(error: Error = new ClaudeProtocolError('control channel closed')): void {
      closed ??= error
      for (const id of pending.keys()) finish(id, { error: closed })
    },
  }
}
