/**
 * Tests for the control-request router.
 *
 * Covers:
 *   - `can_use_tool` dispatch + default-deny
 *   - generic `onControlRequest` fallback for unknown subtypes
 *   - dedupe of repeated request_ids
 *   - thrown handler errors become `{subtype:'error'}` responses
 *   - pending decisions, exact replay, bounded completed history and pressure refusal
 */

import { createControlRouter } from '#features/code/be/services/claude-code/control.ts'
import type { ControlRequestLine } from '#features/code/be/services/claude-code/types.ts'

function makeRequest(requestId: string, subtype: string, extra: Record<string, unknown> = {}): ControlRequestLine {
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype, ...extra },
  } as ControlRequestLine
}

interface SuccessResponse {
  type: 'control_response'
  response: { subtype: 'success'; request_id: string; response: unknown }
}
interface ErrorResponse {
  type: 'control_response'
  response: { subtype: 'error'; request_id: string; error: string }
}

function isSuccess(r: unknown): r is SuccessResponse {
  return !!r && typeof r === 'object' && (r as any).response?.subtype === 'success'
}
function isError(r: unknown): r is ErrorResponse {
  return !!r && typeof r === 'object' && (r as any).response?.subtype === 'error'
}

describe('createControlRouter', () => {
  describe('can_use_tool', () => {
    it('forwards to onPermissionRequest and wraps the decision as success', async () => {
      const calls: any[] = []
      const router = createControlRouter({
        onPermissionRequest: async (req) => {
          calls.push(req)
          // Echo req.input back as updatedInput — required by the CLI's
          // Zod validator at PermissionPromptToolResultSchema.ts:44-63.
          return { behavior: 'allow', updatedInput: req.input }
        },
      })

      const line = makeRequest('r1', 'can_use_tool', {
        tool_name: 'Bash',
        input: { command: 'ls' },
        tool_use_id: 'tu1',
      })
      const response = await router.handle(line)

      expect(calls).toHaveLength(1)
      expect(calls[0].tool_name).toBe('Bash')
      expect(isSuccess(response)).toBe(true)
      if (isSuccess(response)) {
        expect(response.response.request_id).toBe('r1')
        expect(response.response.response).toEqual({
          behavior: 'allow',
          updatedInput: { command: 'ls' },
        })
      }
    })

    it('defaults to deny when no permission handler is configured', async () => {
      const router = createControlRouter({})
      const response = await router.handle(makeRequest('r1', 'can_use_tool', {
        tool_name: 'Bash', input: {}, tool_use_id: 'tu1',
      }))
      expect(isSuccess(response)).toBe(true)
      if (isSuccess(response)) {
        expect((response.response.response as any).behavior).toBe('deny')
      }
    })
  })

  describe('unknown subtypes', () => {
    it('forwards to onControlRequest when provided', async () => {
      const router = createControlRouter({
        onControlRequest: async (req) => ({ echoed: req.subtype }),
      })
      const response = await router.handle(makeRequest('r1', 'hook_callback', { callback_id: 'h1' }))
      expect(isSuccess(response)).toBe(true)
      if (isSuccess(response)) {
        expect(response.response.response).toEqual({ echoed: 'hook_callback' })
      }
    })

    it('returns an error response when no hook is configured', async () => {
      const router = createControlRouter({})
      const response = await router.handle(makeRequest('r1', 'mcp_message'))
      expect(isError(response)).toBe(true)
      if (isError(response)) {
        expect(response.response.error).toContain('unhandled control_request subtype "mcp_message"')
      }
    })
  })

  describe('error recovery', () => {
    it('converts a thrown handler error into an error response', async () => {
      const router = createControlRouter({
        onPermissionRequest: () => { throw new Error('boom') },
      })
      const response = await router.handle(makeRequest('r1', 'can_use_tool', {
        tool_name: 'Bash', input: {}, tool_use_id: 'tu1',
      }))
      expect(isError(response)).toBe(true)
      if (isError(response)) {
        expect(response.response.error).toBe('boom')
      }
    })

    it('converts a non-Error throw into a stringified error response', async () => {
      const router = createControlRouter({
        onPermissionRequest: () => { throw 'string-error' as unknown as Error },
      })
      const response = await router.handle(makeRequest('r1', 'can_use_tool', {
        tool_name: 'Bash', input: {}, tool_use_id: 'tu1',
      }))
      expect(isError(response)).toBe(true)
      if (isError(response)) {
        expect(response.response.error).toBe('string-error')
      }
    })
  })

  describe('dedupe', () => {
    it('does not re-dispatch a handler for a repeated request_id', async () => {
      const handler = vi.fn(async () => ({ behavior: 'allow' as const, updatedInput: {} }))
      const router = createControlRouter({ onPermissionRequest: handler })

      const line = makeRequest('same-id', 'can_use_tool', {
        tool_name: 'Bash', input: {}, tool_use_id: 'tu1',
      })

      const first = await router.handle(line)
      const second = await router.handle(line)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(isSuccess(first)).toBe(true)
      expect(isSuccess(second)).toBe(true)
      if (isSuccess(second)) {
        expect(second.response.request_id).toBe('same-id')
        expect(second.response.response).toEqual({ behavior: 'allow', updatedInput: {} })
      }
    })
  })
})

it('waits for the same pending permission decision instead of answering empty success', async () => {
  let decide!: (value: {behavior:'deny';message:string}) => void
  const handler = vi.fn(() => new Promise<{behavior:'deny';message:string}>(resolve => {decide=resolve}))
  const router = createControlRouter({onPermissionRequest:handler}), line=makeRequest('pending','can_use_tool',{tool_name:'Bash',tool_use_id:'tool',input:{command:'rm file'}})
  const first=router.handle(line), second=router.handle(line)
  let settled=false;void second.then(()=>{settled=true})
  await Promise.resolve();await Promise.resolve();expect(settled).toBe(false);expect(handler).toHaveBeenCalledOnce()
  decide({behavior:'deny',message:'Keep the file'})
  expect(await second).toEqual(await first)
  expect((await second as SuccessResponse).response.response).toEqual({behavior:'deny',message:'Keep the file'})
})
it('replays the original failure rather than converting it to success', async () => {
  const handler=vi.fn(async()=>{throw Error('Permission owner closed')}),router=createControlRouter({onControlRequest:handler}),line=makeRequest('failed','elicitation')
  const first=await router.handle(line);expect(isError(first)).toBe(true);expect(await router.handle(line)).toEqual(first);expect(handler).toHaveBeenCalledOnce()
})
it('retains a serialized decision independently of subsequent caller mutation', async () => {
  const decision={behavior:'allow' as const,updatedInput:{command:'safe'}},router=createControlRouter({onPermissionRequest:()=>decision}),line=makeRequest('immutable','can_use_tool',{tool_name:'Bash',tool_use_id:'tool',input:{}})
  const first=await router.handle(line) as SuccessResponse;decision.updatedInput.command='changed';(first.response.response as typeof decision).updatedInput.command='also changed'
  expect((await router.handle(line) as SuccessResponse).response.response).toEqual({behavior:'allow',updatedInput:{command:'safe'}})
})
it('evicts old completed responses while retaining recent exact replies', async () => {
  const handler=vi.fn(async request=>({id:request.id})),router=createControlRouter({onControlRequest:handler})
  for(let i=0;i<501;i++)await router.handle(makeRequest('id-'+i,'hook_callback',{id:i}))
  expect((await router.handle(makeRequest('id-500','hook_callback',{id:500})) as SuccessResponse).response.response).toEqual({id:500});expect(handler).toHaveBeenCalledTimes(501)
  await router.handle(makeRequest('id-0','hook_callback',{id:0}));expect(handler).toHaveBeenCalledTimes(502)
})
it('refuses excess pending work without evicting a decision still owned by its handler', async () => {
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve}),handler=vi.fn(async()=>{await held;return {done:true}}),router=createControlRouter({onControlRequest:handler})
  const pending=Array.from({length:500},(_,i)=>router.handle(makeRequest('pending-'+i,'hook_callback')))
  await Promise.resolve();const refused=await router.handle(makeRequest('overflow','hook_callback'));expect(isError(refused)).toBe(true);expect(handler).toHaveBeenCalledTimes(500)
  const duplicate=router.handle(makeRequest('pending-0','hook_callback'));release();expect(await duplicate).toEqual(await pending[0]);await Promise.all(pending);expect(handler).toHaveBeenCalledTimes(500)
})
it('does not rerun a handler whose completed response exceeds the replay byte budget', async () => {
  const handler=vi.fn(async()=>({text:'x'.repeat(32*1024*1024+1)})),router=createControlRouter({onControlRequest:handler}),line=makeRequest('large','mcp_message')
  expect(((await router.handle(line) as SuccessResponse).response.response as {text:string}).text.length).toBe(32*1024*1024+1)
  const replay=await router.handle(line);expect(isError(replay)).toBe(true);if(isError(replay))expect(replay.response.error).toContain('too large to replay');expect(handler).toHaveBeenCalledOnce()
})
