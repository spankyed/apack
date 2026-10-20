import { createHash, randomUUID } from 'node:crypto'
import vm from 'node:vm'
import { claudeTerminalTaskRuntime } from '#features/code/be/services/claude-code/terminal-task-runtime.ts'
function fixture() {
  const tasks: { id: string; agentId: string; type: string; status: string; description: string; identity?: { agentName: string } }[] = [{ id: 'registry-a', agentId: 'agent-a', type: 'local_agent', status: 'running', description: 'Worker' }]
  const registry = { get: (id: string) => tasks.find(task => task.id === id), all: () => Object.fromEntries(tasks.map(task => [task.id, task])), getTranscript: vi.fn(() => ({ messages: [{ uuid: 'live', type: 'assistant', message: { content: [{ type: 'text', text: 'Live progress' }] } }] })) }
  const messageQueue = { getCommandQueueSnapshot: vi.fn(() => []) }, getMessages = vi.fn(() => [])
  const liveGate = vi.fn((_queue: unknown, read: () => unknown) => read)
  const nativeState: { viewingAgentTaskId?: string } = {}
  const show = vi.fn(async (value: { agentId?: string }) => { nativeState.viewingAgentTaskId = value.agentId === undefined ? undefined : tasks.find(task => task.agentId === value.agentId)?.id; return 'shown' })
  const context = { messageQueue, getMessages, taskRegistry: registry, session: {}, storageV5: {}, getAppState: vi.fn(() => nativeState), setAppState: vi.fn() }
  const stop = vi.fn(async () => {}), saved = vi.fn(async (): Promise<Record<string, unknown>[]> => [{ uuid: 'saved', type: 'user', message: { content: 'Task instruction' } }, { uuid: 'hidden', type: 'user', isMeta: true, message: { content: 'Hidden context' } }])
  const pin = vi.fn(), append = vi.fn(), queue = vi.fn(), raceQueue = vi.fn(() => true)
  class ResumeRace extends Error {}
  let resumeResult: unknown = { agentId: 'agent-a' }
  const resume = vi.fn(async () => resumeResult)
  const canUseTool = vi.fn(), tools = [{ name: 'SendMessage' }]
  let denied = false
  const message = vi.fn((value: unknown) => value)
  const runner = vi.fn(async function* (call: { id: string }, _assistant: unknown, _permission: unknown, _context: unknown, _clock: unknown) { yield { message: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: call.id, ...(denied ? { is_error: true, content: 'Native refusal' } : {}) }] }, toolUseResult: { success: !denied } } } })
  const run = vm.runInNewContext(claudeTerminalTaskRuntime + ';nativeTaskControl', { randomUUID: () => '12345678-1234-1234-1234-123456789abc', retireNativeAgentCommands: async () => {} }) as (n: unknown, binding: unknown, request: unknown, abort: unknown, current: () => void) => Promise<any>
  const request = (operation: string, id = 'agent-a', current: () => void = vi.fn(), text = 'User instruction') => run({ runtime: { Jgr: (origin: { kind?: string } | undefined) => ({ kind: origin?.kind === 'human' ? 'composer' : 'unclassified' }), Dhs: pin, Ae: (value: unknown) => ({ uuid: '12345678-1234-1234-1234-123456789abc', ...value as object }), WXt: append, jXt: queue, CZ: raceQueue, Ewe: (text: string) => 'Native envelope: '+text, Z2: runner, _d: message, flt: (task: typeof tasks[number]) => ({ id: task.agentId }) }, taskInputGate: { ekt: liveGate }, taskControls: { gAe: stop }, taskResume: { MQ: resume, Y$: (value: any) => value?.deniedByPlugin !== undefined, OQ: ResumeRace, uSe: ResumeRace } }, { view: { show }, tools: () => tools, canUseTool, toolContext: () => context, savedAgentMessages: saved }, { operation, task_id: id, text }, new AbortController(), current)
  return { show, nativeState, liveGate, messageQueue, getMessages, pin, append, queue, resume, raceQueue, ResumeRace, setResumeResult(value: unknown) { resumeResult = value }, tasks, registry, context, stop, saved, request, runner, message, canUseTool, tools, refuse() { denied = true } }
}
it('stops the exact native registry task through the original user-stop callback', async () => {
  const f = fixture(); expect(await f.request('stop')).toEqual({ stopped: true })
  expect(f.stop).toHaveBeenCalledExactlyOnceWith('registry-a', { taskRegistry: f.registry, session: f.context.session, storageV5: f.context.storageV5, getAppState: f.context.getAppState, setAppState: f.context.setAppState, source: 'user' })
})
it('rejects foreign and ambiguous task identities before any native operation', async () => {
  const f = fixture(); await expect(f.request('stop', 'foreign')).rejects.toThrow('no longer owned')
  f.tasks.push({ ...f.tasks[0], id: 'registry-b' }); await expect(f.request('stop')).rejects.toThrow('no longer owned')
  expect(f.stop).not.toHaveBeenCalled(); expect(f.saved).not.toHaveBeenCalled()
})
it('reads original saved and live Agent messages without exposing hidden context or stopping work', async () => {
  const f = fixture(); const result = await f.request('inspect')
  expect(result.details.messages).toEqual([{ uuid: 'saved', role: 'user', text: 'Task instruction', renderText: 'Task instruction', origin: { kind: 'unclassified' } }, { uuid: 'live', role: 'assistant', text: 'Live progress', renderText: 'Live progress', origin: { kind: 'unclassified' } }])
  expect(f.registry.getTranscript).toHaveBeenCalledWith('registry-a'); expect(f.saved).toHaveBeenCalledWith('agent-a'); expect(f.stop).not.toHaveBeenCalled()
})
it('refuses a reply when its native session expires during transcript loading', async () => {
  const f = fixture(); let calls = 0
  await expect(f.request('inspect', 'agent-a', () => { if (++calls > 1) throw new Error('Session changed') })).rejects.toThrow('Session changed')
})

it('uses the original permission-aware runner and confirms only its structured send result', async () => {
  const f = fixture(); expect(await f.request('send')).toEqual({ sent: true })
  expect(f.runner.mock.calls[0][0]).toEqual(expect.objectContaining({ name: 'SendMessage', input: { to: 'agent-a', message: 'User instruction' } }))
  expect(f.runner.mock.calls[0][2]).toBe(f.canUseTool)
  expect(f.message).toHaveBeenCalledWith(expect.objectContaining({ isVirtual: true }))
  expect(f.stop).not.toHaveBeenCalled()
})
it('preserves native messaging refusal and refuses empty, oversized or unavailable sends', async () => {
  const f = fixture(); f.refuse(); await expect(f.request('send')).rejects.toThrow('Native refusal')
  f.runner.mockClear(); await expect(f.request('send', 'agent-a', vi.fn(), ' ')).rejects.toThrow('1 to 16384')
  await expect(f.request('send', 'agent-a', vi.fn(), 'x'.repeat(16385))).rejects.toThrow('1 to 16384')
  f.tools.length = 0; await expect(f.request('send')).rejects.toThrow('not available')
  expect(f.runner).not.toHaveBeenCalled()
})

it('retains received coordinator instructions and live transcript order across overlapping saved rows', async () => {
  const f = fixture()
  const first = { uuid: 'first', type: 'user', message: { content: 'Initial task' } }
  const instruction = { uuid: 'instruction', type: 'user', isMeta: true, origin: { kind: 'coordinator' }, message: { content: 'Sent instruction' } }
  const reply = { uuid: 'reply', type: 'assistant', message: { content: [{ type: 'text', text: 'Agent reply' }] } }
  f.saved.mockResolvedValue([reply, first])
  f.registry.getTranscript.mockReturnValue({ messages: [first, instruction, reply] } as ReturnType<typeof f.registry.getTranscript>)
  expect((await f.request('inspect')).details.messages.map((message: { text: string }) => message.text)).toEqual(['Initial task', 'Sent instruction', 'Agent reply'])
})

it('orders saved-only coordinator messages by native timestamps between live prompt and reply', async () => {
  const f = fixture()
  const first = { uuid: 'first', type: 'user', timestamp: '2026-10-18T12:00:00Z', message: { content: 'Initial task' } }
  const instruction = { uuid: 'instruction', type: 'user', timestamp: '2026-10-18T12:00:01Z', isMeta: true, origin: { kind: 'coordinator' }, message: { content: 'Sent instruction' } }
  const reply = { uuid: 'reply', type: 'assistant', timestamp: '2026-10-18T12:00:02Z', message: { content: [{ type: 'text', text: 'Agent reply' }] } }
  f.saved.mockResolvedValue([instruction])
  f.registry.getTranscript.mockReturnValue({ messages: [first, reply] } as ReturnType<typeof f.registry.getTranscript>)
  expect((await f.request('inspect')).details.messages.map((message: { text: string }) => message.text)).toEqual(['Initial task', 'Sent instruction', 'Agent reply'])
})

it('uses a teammate name only for a live record and keeps ended opaque identities exact', async () => {
  const f = fixture(); Object.assign(f.tasks[0], { type: 'in_process_teammate', identity: { agentName: 'worker' } })
  await f.request('send'); expect(f.runner.mock.calls[0][0]).toEqual(expect.objectContaining({ input: { to: 'worker', message: 'User instruction' } }))
  f.tasks[0].status = 'completed'; f.runner.mockClear()
  await f.request('send'); expect(f.runner.mock.calls[0][0]).toEqual(expect.objectContaining({ input: { to: 'agent-a', message: 'User instruction' } }))
})
it('refuses an ended teammate address so a reused name cannot receive the old task message', async () => {
  const f = fixture(); Object.assign(f.tasks[0], { type: 'in_process_teammate', agentId: 'worker@team', status: 'completed', identity: { agentName: 'worker' } })
  expect((await f.request('inspect', 'worker@team')).details.canMessage).toBe(false)
  await expect(f.request('send', 'worker@team')).rejects.toThrow('No live teammate')
  expect(f.runner).not.toHaveBeenCalled()
})

it('projects native detail counters with result precedence and completed paused duration', async () => {
  const f = fixture()
  Object.assign(f.tasks[0], { status: 'completed', prompt: 'Original prompt', model: 'native-model', effort: 'high', startTime: 1000, endTime: 5500, totalPausedMs: 500, progress: { tokenCount: 5, toolUseCount: 2 }, result: { totalTokens: 0, totalToolUseCount: 4 } })
  expect((await f.request('inspect')).details.metadata).toEqual(expect.objectContaining({ prompt: 'Original prompt', promptTruncated: false, model: 'native-model', effort: 'high', elapsedMs: 4000, tokenCount: 0, toolUseCount: 4 }))
})
it('bounds original prompts/errors explicitly and omits invalid native numeric details', async () => {
  const f = fixture()
  Object.assign(f.tasks[0], { status: 'failed', prompt: 'p'.repeat(17000), error: 'e'.repeat(17000), startTime: NaN, progress: { tokenCount: -1, toolUseCount: Infinity } })
  const metadata = (await f.request('inspect')).details.metadata
  expect(metadata.prompt).toHaveLength(16384); expect(metadata.error).toHaveLength(16384)
  expect(metadata).toEqual(expect.objectContaining({ promptTruncated: true, errorTruncated: true, elapsedMs: undefined, tokenCount: undefined, toolUseCount: undefined }))
})

it('retains native integer effort budgets in the displayed effort value', async () => {
  const f = fixture(); Object.assign(f.tasks[0], { effort: 2048 })
  expect((await f.request('inspect')).details.metadata.effort).toBe('2048')
})

it('queues human input with native transcript identity without requiring the SendMessage tool', async () => {
  const f = fixture(); f.tools.length = 0
  expect((await f.request('inspect')).details.canInput).toBe(true)
  expect(await f.request('input')).toEqual({ input: { messageId: '12345678-1234-1234-1234-123456789abc', mode: 'queued' } })
  expect(f.pin).toHaveBeenCalledWith('registry-a', f.registry)
  expect(f.append).toHaveBeenCalledWith('registry-a', expect.objectContaining({ origin: { kind: 'human' }, content: 'User instruction' }), f.registry)
  expect(f.queue).toHaveBeenCalledWith('registry-a', 'User instruction', f.registry, { isMeta: true, origin: { kind: 'human' }, shownAs: '12345678-1234-1234-1234-123456789abc' })
  expect(f.runner).not.toHaveBeenCalled(); expect(f.resume).not.toHaveBeenCalled()
})
it('resumes ended Agents with original permission context and preserves native refusal', async () => {
  const f = fixture(); f.tasks[0].status = 'completed'
  expect((await f.request('input')).input.mode).toBe('resumed')
  expect(f.liveGate).toHaveBeenCalledWith(f.messageQueue, f.getMessages)
  expect(f.resume).toHaveBeenCalledWith(expect.objectContaining({ liveTranscript: f.getMessages, agentId: 'registry-a', promptOrigin: { kind: 'human' }, toolUseContext: f.context, canUseTool: f.canUseTool, userInitiated: true }))
  f.setResumeResult({ deniedByPlugin: 'Managed restriction' }); await expect(f.request('input')).rejects.toThrow('Managed restriction')
  expect(f.queue).not.toHaveBeenCalled(); expect(f.raceQueue).not.toHaveBeenCalled()
})
it('queues only original native resume-lock races without retrying unrelated failures', async () => {
  const f = fixture(); f.tasks[0].status = 'completed'; f.resume.mockRejectedValueOnce(new f.ResumeRace('Already resumed'))
  expect((await f.request('input')).input.mode).toBe('queued'); expect(f.raceQueue).toHaveBeenCalledTimes(1)
  f.resume.mockRejectedValueOnce(new Error('Storage failure')); await expect(f.request('input')).rejects.toThrow('Storage failure')
  expect(f.raceQueue).toHaveBeenCalledTimes(1)
})
it('deduplicates native human envelopes against visible live human messages and retains saved-only input', async () => {
  const f = fixture()
  f.saved.mockResolvedValue([{ uuid: 'meta', type: 'user', isMeta: true, origin: { kind: 'human' }, message: { content: 'Native envelope: Typed reply' } }])
  f.registry.getTranscript.mockReturnValue({ messages: [{ uuid: 'visible', type: 'user', origin: { kind: 'human' }, message: { content: 'Typed reply' } }] } as any)
  expect((await f.request('inspect')).details.messages).toEqual([{ uuid: 'visible', role: 'user', text: 'Typed reply', renderText: 'Typed reply', origin: { kind: 'composer' } }])
  f.registry.getTranscript.mockReturnValue({ messages: [] })
  expect((await f.request('inspect')).details.messages).toEqual([{ uuid: 'meta', role: 'user', text: 'Native envelope: Typed reply' }])
})

it('refuses ended input before native transcript writes when its live queue context is unavailable', async () => {
  const f = fixture(); f.tasks[0].status = 'completed'
  Object.assign(f.context, { messageQueue: undefined })
  await expect(f.request('input')).rejects.toThrow('Native live transcript context is unavailable')
  expect(f.pin).not.toHaveBeenCalled(); expect(f.append).not.toHaveBeenCalled(); expect(f.resume).not.toHaveBeenCalled()
})

it('uses original native view selection and returns only after exact registry selection', async () => {
  const f = fixture()
  expect(await f.request('foreground')).toEqual({ view: { taskId: 'agent-a' } })
  expect(f.show).toHaveBeenCalledWith({ agentId: 'agent-a' }); expect(f.nativeState.viewingAgentTaskId).toBe('registry-a')
  expect(await f.request('background')).toEqual({ view: { taskId: null } })
  expect(f.show).toHaveBeenLastCalledWith({}); expect(f.nativeState.viewingAgentTaskId).toBeUndefined()
})
it('refuses native selection denial, moved selection and foreign return requests', async () => {
  const f = fixture(); f.show.mockResolvedValueOnce('hidden')
  await expect(f.request('foreground')).rejects.toThrow('unavailable')
  f.show.mockResolvedValueOnce('shown'); await expect(f.request('foreground')).rejects.toThrow('moved')
  f.nativeState.viewingAgentTaskId = 'registry-a'
  await expect(f.request('background', 'other-agent')).rejects.toThrow('different native Agent')
  expect(f.show).toHaveBeenCalledTimes(2)
})

it('returns from a retired native view safely but refuses empty task identity', async () => {
  const f = fixture(); f.nativeState.viewingAgentTaskId = 'retired-task'
  await expect(f.request('background', '')).rejects.toThrow('Invalid native task operation')
  expect(f.show).not.toHaveBeenCalled()
  expect(await f.request('background')).toEqual({ view: { taskId: null } })
})

it('keeps Workflow identity and stop native without admitting Agent-only operations', async () => {
 const f=fixture();f.tasks.push({id:'workflow-a',agentId:'not-an-agent',type:'local_workflow',status:'running',description:'Review release notes'})
 const result=await f.request('inspect','workflow-a')
 expect(result.details).toMatchObject({taskId:'workflow-a',name:'Review release notes',status:'running',canInput:false,canMessage:false,workflow:{agentCount:0,phaseCount:0},messages:[]})
 expect(f.saved).not.toHaveBeenCalled();expect(f.registry.getTranscript).not.toHaveBeenCalled()
 for(const operation of ['foreground','send','input'])await expect(f.request(operation,'workflow-a')).rejects.toThrow('inspection and native stop only')
 expect(await f.request('stop','workflow-a')).toEqual({stopped:true});expect(f.stop).toHaveBeenCalledWith('workflow-a',expect.objectContaining({taskRegistry:f.registry,source:'user'}))
 expect(f.show).not.toHaveBeenCalled();expect(f.runner).not.toHaveBeenCalled()
})

it('previews original Workflow phase/worker progress and terminal output without rewriting native state', () => {
 const project=vm.runInNewContext(claudeTerminalTaskRuntime+';nativeWorkflowProgress')
 const task={workflowProgress:[{type:'workflow_phase',index:1,title:'Review',kind:'parallel'},{type:'workflow_agent',index:1,label:'Release reviewer',phaseIndex:1,state:'done',resultPreview:'Worker result',tokens:12}],logs:['Review finished'],result:{review:'ready'}}
 const before=JSON.stringify(task),result=project({},task)
 expect(result).toMatchObject({progress:task.workflowProgress,logs:task.logs,output:'{"review":"ready"}',outputUnavailable:false,truncated:false})
 expect(JSON.stringify(task)).toBe(before)
})
it('uses original Workflow withholding sanitizers and bounds previews explicitly', () => {
 const project=vm.runInNewContext(claudeTerminalTaskRuntime+';nativeWorkflowProgress'),sanitize=vi.fn(()=>[{type:'workflow_phase',index:1,title:'phase 1'}]),filter=vi.fn((event:any)=>event.type!=='workflow_log')
 const hidden={workflowProgress:[{type:'workflow_phase',index:1,title:'Private phase'},{type:'workflow_log',message:'Private log'}],logs:['Private log'],withholdScriptFromSdkEvents:true}
 expect(project({workflowTasks:{$ar:sanitize,mAn:filter}},hidden)).toMatchObject({progress:[{type:'workflow_phase',index:1,title:'phase 1'}],logs:[]})
 expect(sanitize).toHaveBeenCalledWith([hidden.workflowProgress[0]])
 const circular:any={};circular.self=circular
 const bounded=project({},{workflowProgress:Array.from({length:101},(_,index)=>({type:'workflow_agent',index,label:'x'.repeat(10000)})),result:circular})
 expect(bounded.progress).toHaveLength(100);expect(bounded.truncated).toBe(true);expect(bounded.outputUnavailable).toBe(true)
 expect(bounded.progress.reduce((sum:number,event:any)=>sum+(event.label?.length??0),0)).toBeLessThanOrEqual(65536)
})

function workflowWorkerFixture() {
 const event={type:'workflow_agent',index:1,label:'Reviewer',agentId:'worker-a',state:'start'},controller=new AbortController()
 const task={id:'workflow-a',type:'local_workflow',status:'running',workflowRunId:'run-a',workflowProgress:[event],agentControllers:new Map([['worker-a',controller]])}
 const registry={all:()=>({[task.id]:task})},skip=vi.fn(()=>true),retry=vi.fn(()=>true)
 const n={workflowTasks:{_ot:skip,Sot:retry}},binding={toolContext:()=>({taskRegistry:registry})}
 const run=vm.runInNewContext(claudeTerminalTaskRuntime+';({control:nativeTaskControl,progress:nativeWorkflowProgress})',{createHash,randomUUID})
 const token=()=>run.progress(n,task).progress[0].controlToken
 const request=(operation:string,value=token())=>run.control(n,binding,{task_id:task.id,operation,worker:{agentId:event.agentId,token:value}},new AbortController(),()=>{})
 return {event,controller,task,registry,skip,retry,token,request}
}
it('dispatches native Workflow worker IDs and refuses controller capabilities after abort/replacement', async () => {
 const f=workflowWorkerFixture(),old=f.token()
 expect(old).toMatch(/^[a-f0-9]{64}$/);expect(f.token()).toBe(old)
 expect(await f.request('retry_worker',old)).toEqual({worker:{agentId:'worker-a',operation:'retry_worker',accepted:true}})
 expect(f.retry).toHaveBeenCalledExactlyOnceWith('workflow-a','worker-a',f.registry)
 f.controller.abort();await expect(f.request('skip_worker',old)).rejects.toThrow('changed or expired')
 f.task.agentControllers.set('worker-a',new AbortController());expect(f.token()).not.toBe(old)
 await expect(f.request('skip_worker',old)).rejects.toThrow('changed or expired')
 expect(await f.request('skip_worker')).toMatchObject({worker:{accepted:true,operation:'skip_worker'}})
 expect(f.skip).toHaveBeenCalledExactlyOnceWith('workflow-a','worker-a',f.registry)
})
it('withdraws Workflow worker controls at terminal states and never invents native acknowledgement', async () => {
 const f=workflowWorkerFixture();f.retry.mockReturnValue(false)
 await expect(f.request('retry_worker')).rejects.toThrow('action refused')
 f.event.state='done';expect(f.token()).toBeUndefined()
 f.event.state='start';f.task.status='completed';expect(f.token()).toBeUndefined()
 await expect(f.request('skip_worker','0'.repeat(64))).rejects.toThrow('changed or expired')
 expect(f.skip).not.toHaveBeenCalled()
})
