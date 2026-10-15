import { randomUUID } from 'node:crypto'
import { z } from 'zod'

export interface ClaudeHookRegistration {
  matcher?: string
  timeout?: number
  callbacks: Array<(input: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>>
}
export type ClaudeHooks = Record<string, ClaudeHookRegistration[]>

/** Serialize callback identities, never functions, into native initialize metadata. */
export function createHookRegistry(hooks: ClaudeHooks = {}) {
  const callbacks = new Map<string, ClaudeHookRegistration['callbacks'][number]>()
  const registrations: Record<string, Array<{ matcher?: string; timeout?: number; hookCallbackIds: string[] }>> = {}
  for (const [event, entries] of Object.entries(hooks)) {
    registrations[event] = entries.map(entry => {
      if (entry.timeout !== undefined && (!Number.isFinite(entry.timeout) || entry.timeout <= 0)) {
        throw new Error('Hook timeout must be positive and finite')
      }
      return { matcher: entry.matcher, timeout: entry.timeout, hookCallbackIds: entry.callbacks.map(callback => {
        if (typeof callback !== 'function') throw new Error('Hook callback must be a function')
        const id = randomUUID()
        callbacks.set(id, callback)
        return id
      }) }
    })
  }
  return {
    registrations,
    callbackIds: new Set(callbacks.keys()),
    async handle(request: Record<string, unknown>): Promise<Record<string, unknown>> {
      const value = z.object({ callback_id: z.string(), input: z.record(z.unknown()) }).parse(request)
      const callback = callbacks.get(value.callback_id)
      if (!callback) throw new Error('Unknown native hook callback')
      return z.record(z.unknown()).parse(await callback(value.input))
    },
  }
}
