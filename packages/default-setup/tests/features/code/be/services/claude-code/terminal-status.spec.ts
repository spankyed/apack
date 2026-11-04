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

it('projects MCP activity atomically and retires it on session replacement', () => {
  const session='12345678-1234-1234-1234-123456789abc',status=createClaudeTerminalStatus(session)
  const task={id:'registry-mcp',name:'Review workspace',status:'running',canStop:true,mcp:{serverTaskId:'server-task-42',status:'input_required',startTime:1000,protocol:'sep2663',truncated:false}}
  expect(status.updateActivityTasks(session,[],[],[task], [])).toBe(true)
  expect(status.tasks).toEqual([{...task,kind:'mcp'}])
  expect(status.updateActivityTasks('foreign',[],[],[], [])).toBe(false)
  expect(status.updateActivityTasks(session,[],[],[{...task,mcp:{...task.mcp,startTime:-1}}], [])).toBe(false)
  expect(status.tasks).toEqual([{...task,kind:'mcp'}])
  expect(status.updateSession('22345678-1234-1234-1234-123456789abc',[])).toBe(true)
  expect(status.tasks).toEqual([])
})


it('atomically projects manager-owned tasks and refuses unknown types and stale sessions', () => {
  const state=createClaudeTerminalStatus(session)
  const task={id:'remote-review',nativeTaskType:'remote_agent',name:'Release review',status:'running'}
  expect(state.updateActivityTasks(session,[],[],[],[task])).toBe(true)
  expect(state.tasks).toEqual([{...task,kind:'managed'}])
  expect(state.updateActivityTasks(session,[],[],[],[{...task,nativeTaskType:'local_agent'}])).toBe(false)
  expect(state.updateActivityTasks('foreign',[],[],[],[])).toBe(false)
  expect(state.tasks).toHaveLength(1)
  expect(state.updateActivityTasks(session,[],[],[],[{...task,status:'completed'}])).toBe(false)
  state.updateSession('22222222-2222-2222-2222-222222222222',[])
  expect(state.tasks).toEqual([])
})
