import { createClaudeTerminalStatus } from '#features/code/be/services/claude-code/terminal-status.ts'
const session = '11111111-1111-1111-1111-111111111111'
const main = (stdout = 'Native status', startedAt = '10') => ({ sessionId: session, kind: 'main', stdout, code: 0, signal: null, truncated: false, startedAt })
it('preserves ANSI and multiline native normalization, clears failures, and rejects out-of-order or foreign output', () => {
  const state = createClaudeTerminalStatus(session)
  expect(state.accept(main(' \n \x1b[36mNative 日本語\x1b[0m  \n\n Second \n '))).toBe(true)
  expect(state.mainStatus).toBe('\x1b[36mNative 日本語\x1b[0m\nSecond')
  expect(state.accept({ ...main('Later', '12'), code: 7 })).toBe(true)
  expect(state.mainStatus).toBeUndefined()
  expect(state.accept(main('Late old result', '11'))).toBe(false)
  expect(state.accept({ ...main(), sessionId: 'foreign' })).toBe(false)
  state.accept({ ...main('Truncated', '13'), truncated: true }); expect(state.mainStatus).toBeUndefined()
  state.accept(main(' \n ', '14')); expect(state.mainStatus).toBeUndefined()
})
it('filters malformed and foreign decorations and retires running text when native task state changes', () => {
  const state = createClaudeTerminalStatus(session)
  state.updateSession(session, [{ id: 'native-task', type: 'research', status: 'running' }])
  const frame = { ...main(), kind: 'subagent', tasks: [{ id: 'native-task', status: 'running' }], stdout: 'not JSON\n{"id":"foreign","content":"Wrong owner"}\n{"id":"native-task","content":"Old"}\n{"id":"native-task","content":"Native running"}' }
  expect(state.accept(frame)).toBe(true)
  expect(state.tasks).toEqual([{ id: 'native-task', name: 'research', status: 'running', statusText: 'Native running' }])
  state.updateSession(session, [{ id: 'native-task', type: 'research', status: 'completed' }])
  expect(state.tasks[0].statusText).toBeUndefined()
  expect(state.accept({ ...frame, startedAt: '11' })).toBe(true)
  expect(state.tasks[0].statusText).toBeUndefined()
  state.accept({ ...frame, tasks: [{ id: 'native-task', status: 'completed' }], startedAt: '12' })
  expect(state.tasks[0].statusText).toBe('Native running') // the native helper owns the text, not our interpretation of it
  state.updateSession(session, []); expect(state.tasks).toEqual([])
})
it('clears all state and rejects stale callbacks across a native conversation reset', () => {
  const state = createClaudeTerminalStatus(session)
  state.accept(main())
  state.updateSession('22222222-2222-2222-2222-222222222222', [])
  expect(state.mainStatus).toBeUndefined(); expect(state.accept(main())).toBe(false)
  state.clear(); expect(state.tasks).toEqual([])
})

it('projects Workflows separately and refuses Agent status decoration for them', () => {
 const status=createClaudeTerminalStatus('12345678-1234-1234-1234-123456789abc')
 expect(status.updateWorkflows(status.sessionId,[{id:'workflow-a',name:'Review release notes',status:'running',settled:false,canPause:true,canResume:false,canStop:true}])).toBe(true)
 expect(status.tasks).toEqual([{id:'workflow-a',kind:'workflow',name:'Review release notes',status:'running',settled:false,canPause:true,canResume:false,canStop:true}])
 status.accept({sessionId:status.sessionId,kind:'subagent',stdout:JSON.stringify({id:'workflow-a',content:'Wrong Agent status'}),truncated:false,startedAt:'1',code:0,tasks:[{id:'workflow-a',status:'running'}]})
 expect(status.tasks[0].statusText).toBeUndefined()
 status.updateSession(status.sessionId,[{id:'agent-a',type:'reviewer',status:'running'}]);expect(status.tasks.find(task=>task.id==='workflow-a')?.kind).toBe('workflow')
 expect(status.updateWorkflows('foreign',[])).toBe(false)
})
