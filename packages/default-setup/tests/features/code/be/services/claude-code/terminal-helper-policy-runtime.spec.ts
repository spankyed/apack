import { claudeTerminalHelperPolicyRuntime } from '#features/code/be/services/claude-code/terminal-helper-policy-runtime.ts'

// Execute authored adapter code with inert settings; no original Claude modules are loaded.
const snapshot = new Function('effective', 'policy', claudeTerminalHelperPolicyRuntime + '\nreturn nativeHelperPolicySnapshot(effective, policy)')
const command = (value: string) => ({ type: 'command', command: value })

it('includes both configured commands in policy snapshots without adding unrelated argv fields', () => {
  expect(snapshot({ statusLine: { ...command('main'), args: ['ignored'] }, subagentStatusLine: command('agents') }, {})).toEqual({
    hooksDisabled: false, policy: { allowManagedHooksOnly: false, disableAllHooks: false }, statusCommand: 'main', subagentCommand: 'agents',
  })
})

it('selects managed helper commands when managed-only policy excludes user configuration', () => {
  expect(snapshot({ statusLine: command('user'), subagentStatusLine: command('user-agents') }, { allowManagedHooksOnly: true, subagentStatusLine: command('managed-agents') })).toEqual({
    hooksDisabled: false, policy: { allowManagedHooksOnly: true, disableAllHooks: false }, statusCommand: null, subagentCommand: 'managed-agents',
  })
})

it('keeps eligible managed helpers under private suppression and suppresses all helpers under global policy', () => {
  const user = { disableAllHooks: true, subagentStatusLine: command('user') }
  expect(snapshot(user, { subagentStatusLine: command('managed') }).subagentCommand).toBe('managed')
  expect(snapshot(user, { disableAllHooks: true, statusLine: command('main'), subagentStatusLine: command('managed') })).toEqual({
    hooksDisabled: true, policy: { allowManagedHooksOnly: false, disableAllHooks: true }, statusCommand: null, subagentCommand: null,
  })
})

it('reports absent and unsupported helpers as explicit null commands', () => {
  expect(snapshot({ statusLine: { type: 'prompt', command: 'unsupported' }, subagentStatusLine: { type: 'command', command: [] } }, {})).toMatchObject({ statusCommand: null, subagentCommand: null })
})
it('reads the original live-session caption cache without creating native state',()=>{
 const read=new Function('n','context','sessionId','command',claudeTerminalHelperPolicyRuntime+'\nreturn nativeMainStatusCache(n,context,sessionId,command)')
 const session={id:'child'},peek=vi.fn(()=>({lastText:'Original cached caption'})),n={runtime:{Mco:{peek}}}
 expect(read(n,{session},'foreign','helper')).toBeNull();expect(read(n,{session},'child',null)).toBeNull();expect(peek).not.toHaveBeenCalled()
 expect(read(n,{session},'child','helper')).toBe('Original cached caption');expect(peek).toHaveBeenCalledWith(session)
 peek.mockReturnValue({lastText:'🙂'.repeat(8193)});expect(read(n,{session},'child','helper')).toBeNull()
})
