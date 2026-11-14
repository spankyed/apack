import vm from 'node:vm'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'

function fixture(mode: string, prePlanMode?: string) {
  let state = { mode, prePlanMode }
  const set = vi.fn((update: (prior: typeof state) => typeof state) => { state = update(state) })
  const apply = vi.fn((target: string, _before: unknown, update: typeof set) => { update(prior => ({ ...prior, mode: target })); return {ok:true,mode:target} })
  const context = {getAppState: () => ({toolPermissionContext:state}),setToolPermissionContext:set}
  // Execute our authored adapter only; the original permission transition remains a stub.
  const start = claudeTerminalUiRuntime.indexOf(" if(request.subtype==='apack_get_permission_mode'")
  const end = claudeTerminalUiRuntime.indexOf(" if(request.subtype==='apack_prompt_outcome')",start)
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start)
  const run = vm.runInNewContext(`(request,n,originalContext)=>{${claudeTerminalUiRuntime.slice(start,end)}}`, {AbortController}) as (request: unknown, native: unknown, binding: unknown) => unknown
  return { apply, set, run: (phase: string) => run({subtype:'apack_set_composer_phase',phase},{permissions:{bC:apply}},{surface:'terminal',toolContext:()=>context}) }
}
it.each([['default','Plan',undefined,'plan'],['acceptEdits','Plan',undefined,'plan'],['plan','Edit','acceptEdits','acceptEdits'],['plan','Edit',undefined,'default'],['default','Edit',undefined,'default']])('uses original permission controls for %s to %s', (mode,phase,prior,expected) => {
  const f = fixture(mode,prior)
  expect(f.run(phase)).toMatchObject({mode:expected})
  expect(f.apply.mock.calls[0]![0]).toBe(expected)
})
it('preserves the original gate refusal and never applies an invented phase', () => {
  const f = fixture('plan','auto')
  f.apply.mockImplementation(() => ({ok:false,mode:'plan',error:'Original auto mode unavailable'}))
  expect(() => f.run('Edit')).toThrow('Original auto mode unavailable')
  expect(f.set).not.toHaveBeenCalled()
  f.apply.mockClear()
  expect(() => f.run('bypassPermissions')).toThrow('Invalid native composer phase')
  expect(f.apply).not.toHaveBeenCalled()
})
it('requires the native live context to acknowledge the requested mode', () => {
  const f = fixture('default')
  f.apply.mockImplementation(() => ({ok:true,mode:'plan'}))
  expect(() => f.run('Plan')).toThrow('Native permission mode was not applied')
})
