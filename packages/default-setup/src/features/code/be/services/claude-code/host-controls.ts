import { createClaudeLifecycleTrace } from './lifecycle-trace.ts'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ClaudeProtocolError } from './errors.ts'

/** Native catalog entries describe availability; custom model IDs may be absent. */
export const ClaudeModelInfoSchema = z.object({
  value: z.string(), displayName: z.string(), resolvedModel: z.string().optional(),
  description: z.string().optional(), supportsEffort: z.boolean().optional(),
  supportedEffortLevels: z.array(z.string()).optional(),
  supportsAdaptiveThinking: z.boolean().optional(), supportsFastMode: z.boolean().optional(),
  supportsAutoMode: z.boolean().optional(), supportsThinkingOff: z.boolean().optional(),
}).passthrough()
export const ClaudeModelCatalogSchema = z.object({ models: z.array(ClaudeModelInfoSchema) }).passthrough()
export type ClaudeModelCatalog = z.infer<typeof ClaudeModelCatalogSchema>

/** Metadata returned by the initialize exchange in Claude Code 2.1.299–2.1.301. */
export const ClaudeInitializationSchema = z.object({
  commands: z.array(z.object({ name: z.string(), description: z.string().optional() }).passthrough()),
  agents: z.array(z.object({ name: z.string() }).passthrough()),
  models: z.array(ClaudeModelInfoSchema),
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

/** Live MCP server state; preserve future status/configuration fields. */
export const ClaudeMcpStatusSchema = z.object({
  mcpServers: z.array(z.object({
    name: z.string(), status: z.string(),
    serverInfo: z.object({ name: z.string(), version: z.string() }).passthrough().optional(),
    tools: z.array(z.object({ name: z.string() }).passthrough()).optional(),
  }).passthrough()),
}).passthrough()
export type ClaudeMcpStatus = z.infer<typeof ClaudeMcpStatusSchema>

/** Native lookup does not create a plan; paths can be omitted by the native access mode. */
export const ClaudePlanSchema = z.discriminatedUnion('exists', [
  z.object({ exists: z.literal(false) }).passthrough(),
  z.object({ exists: z.literal(true), content: z.string(), path: z.string().optional() }).passthrough(),
])
export type ClaudePlan = z.infer<typeof ClaudePlanSchema>

interface PendingControl {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
  trace: ReturnType<typeof createClaudeLifecycleTrace>
}

/** Host-to-CLI requests are independent of CLI-to-host tool permission requests. */
export function createHostControls(write: (value: unknown) => boolean, pid?: number) {
  const pending = new Map<string, PendingControl>()
  let closed: Error | undefined

  function finish(id: string, response: { value: unknown } | { error: Error }): void {
    const waiter = pending.get(id)
    if (!waiter) return
    pending.delete(id)
    waiter.trace('control_end', {outcome:'error' in response ? 'error' : 'ok'})
    waiter.trace('exit', {outcome:'error' in response ? 'error' : 'ok'})
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
      const trace = createClaudeLifecycleTrace('control', undefined, pid)
      trace('control_start')
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { trace('control_end', {outcome:'timeout'}); trace('exit', {outcome:'timeout'}); finish(id, {error:new ClaudeProtocolError(`control request ${request.subtype} timed out after ${timeoutMs}ms`)}) }, timeoutMs)
        timer.unref()
        pending.set(id, { resolve, reject, timer, trace })
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

/** Native rewind verdict; a successful control response may still reject the checkpoint. */
export const ClaudeFileRewindSchema = z.object({
  canRewind: z.boolean(), error: z.string().optional(), filesChanged: z.array(z.string()).optional(),
  insertions: z.number().optional(), deletions: z.number().optional(), skippedLinks: z.number().optional(),
}).passthrough()
export type ClaudeFileRewind = z.infer<typeof ClaudeFileRewindSchema>

/** Native merged settings and source attribution; backend-only, never log or publish the values. */
export const ClaudeSettingsSchema = z.object({
  effective: z.record(z.string(), z.unknown()),
  sources: z.array(z.object({ source: z.string(), settings: z.record(z.string(), z.unknown()) }).passthrough()),
  applied: z.record(z.string(), z.unknown()).optional(),
}).passthrough()
export type ClaudeSettings = z.infer<typeof ClaudeSettingsSchema>
