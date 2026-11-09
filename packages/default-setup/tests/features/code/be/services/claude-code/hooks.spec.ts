import { describe, expect, it, vi } from 'vitest'
import { createHookRegistry } from '../../../../../../src/features/code/be/services/claude-code/hooks.ts'

describe('native hook registry', () => {
  it('serializes opaque identities and routes only owned callbacks with their original input', async () => {
    const callback = vi.fn(async () => ({}))
    const registry = createHookRegistry({ PreToolUse: [{ matcher: 'Bash', callbacks: [callback] }] })
    const id = registry.registrations.PreToolUse[0]!.hookCallbackIds[0]!
    expect(registry.callbackIds.has(id)).toBe(true)
    expect(JSON.stringify(registry.registrations)).not.toContain('callbacks')
    const input = { hook_event_name: 'PreToolUse', tool_name: 'Bash', extra: true }
    await expect(registry.handle({ callback_id: id, input })).resolves.toEqual({})
    expect(callback).toHaveBeenCalledWith(input)
    await expect(registry.handle({ callback_id: 'unregistered', input })).rejects.toThrow('Unknown')
  })
  it('preserves native hook-specific denial output without wrapping it as a tool permission response', async () => {
    const output = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: 'Synthetic hook denies execution' } }
    const registry = createHookRegistry({ PreToolUse: [{ callbacks: [async () => output] }] })
    await expect(registry.handle({ callback_id: registry.registrations.PreToolUse[0]!.hookCallbackIds[0],
      input: { hook_event_name: 'PreToolUse' } })).resolves.toEqual(output)
  })

  it('rejects malformed input and callback failure instead of returning a permission decision', async () => {
    const registry = createHookRegistry({ Stop: [{ callbacks: [async () => { throw new Error('fixture failure') }] }] })
    await expect(registry.handle({ callback_id: registry.registrations.Stop[0]!.hookCallbackIds[0], input: {} }))
      .rejects.toThrow('fixture failure')
    await expect(registry.handle({ callback_id: 'unknown', input: null })).rejects.toThrow()
  })
  it('rejects invalid native timeouts before process launch', () => {
    expect(() => createHookRegistry({ Stop: [{ timeout: -1, callbacks: [async () => ({})] }] })).toThrow('timeout')
  })
})
