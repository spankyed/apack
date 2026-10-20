import { createActor } from 'xstate'
import { startFeTestRuntime } from '@apackdev/sdk/testing'
import { repository } from '#generated/repository.ts'
import { readClaudeComposerPhase, commitClaudeComposerPhase } from '#features/threads/fe/chat/native-composer-phase.ts'
import threadsState from '#features/threads/fe/state.ts'
import { queueClaudeUiRetirement, takeClaudeUiRetirements } from '#features/threads/fe/chat/native-ui-retirement.ts'
vi.hoisted(() => { (globalThis as { addEventListener?: unknown }).addEventListener ??= () => {} })
const sent = vi.fn()
const resumeKey = '11111111-1111-4111-8111-111111111111'
afterAll(startFeTestRuntime({ client: { send: sent } }))

it('ignores another view/thread and late replies after unmount without reviving a closed slot', () => {
  const actor = createActor(threadsState).start()
  actor.send({ type: 'CLAUDE_UI_MOUNT', promptFocused: true, mountId: 'mounted', threadId: 'thread-one' })
  const state = { status: 'live' as const, tree: { kind: 'button' as const, label: 'Run', actionId: 'opaque' } }
  actor.send({ type: 'CLAUDE_UI_STATE', resumeKey, mountId: 'other', threadId: 'thread-one', state })
  actor.send({ type: 'CLAUDE_UI_STATE', resumeKey, mountId: 'mounted', threadId: 'thread-two', state })
  expect(actor.getSnapshot().context.nativeUiViews).toEqual({ mounted: { threadId: 'thread-one', state: { status: 'connecting' }, mountRequest: { type: 'CLAUDE_UI_MOUNT', promptFocused: true, mountId: 'mounted', threadId: 'thread-one' } } })
  actor.send({ type: 'CLAUDE_UI_STATE', resumeKey, mountId: 'mounted', threadId: 'thread-one', state })
  expect(actor.getSnapshot().context.nativeUiViews.mounted?.state).toEqual(state)
  actor.send({ type: 'CLAUDE_UI_UNMOUNT', mountId: 'mounted', threadId: 'thread-one' })
  actor.send({ type: 'CLAUDE_UI_STATE', resumeKey, mountId: 'mounted', threadId: 'thread-one', state })
  expect(actor.getSnapshot().context.nativeUiViews).toEqual({})
  actor.stop()
})


it('correlates native draft replies with the latest edit in the mounted thread slot', () => {
  const actor = createActor(threadsState).start()
  actor.send({ type: 'CLAUDE_UI_MOUNT', promptFocused: true, mountId: 'mounted', threadId: 'thread-one' })
  const edit = { type: 'CLAUDE_PROMPT_EDIT' as const, mountId: 'mounted', threadId: 'thread-one', by: 'person' as const, text: 'draft', cursor: 5 }
  actor.send({ ...edit, revision: 1 }); actor.send({ ...edit, revision: 2 })
  const reply = { type: 'CLAUDE_PROMPT_STATE' as const, mountId: 'mounted', threadId: 'thread-one', result: { revision: 1, status: 'applied' as const, frame: { text: 'OLD', cursor: 3 } } }
  actor.send(reply)
  expect(actor.getSnapshot().context.nativeUiViews.mounted?.prompt).toBeUndefined()
  actor.send({ ...reply, threadId: 'foreign', result: { ...reply.result, revision: 2 } })
  expect(actor.getSnapshot().context.nativeUiViews.mounted?.prompt).toBeUndefined()
  actor.send({ ...reply, result: { ...reply.result, revision: 2 } })
  expect(actor.getSnapshot().context.nativeUiViews.mounted?.prompt?.revision).toBe(2)
  actor.send({ type: 'CLAUDE_UI_STATE', resumeKey, mountId: 'mounted', threadId: 'thread-one', state: { status: 'live', tree: { kind: 'text', text: 'controls' } } })
  expect(actor.getSnapshot().context.nativeUiViews.mounted?.prompt?.revision).toBe(2)
  actor.send({ type: 'CLAUDE_UI_UNMOUNT', mountId: 'mounted', threadId: 'thread-one' }); actor.send({ ...reply, result: { ...reply.result, revision: 2 } })
  expect(actor.getSnapshot().context.nativeUiViews).toEqual({}); actor.stop()
})


it('rejects completion replies from another view or an older edit and retires rows on edit/unmount', () => {
  const actor = createActor(threadsState).start()
  const identity = { mountId: 'view', threadId: 'thread' }
  actor.send({ type: 'CLAUDE_UI_MOUNT', promptFocused: true, ...identity })
  actor.send({ type: 'CLAUDE_PROMPT_EDIT', ...identity, revision: 1, by: 'app', text: 'tok', cursor: 3 })
  actor.send({ type: 'CLAUDE_PROMPT_AUTOCOMPLETE', ...identity, revision: 1, text: 'tok', cursor: 3 })
  const result = { revision: 1, status: 'ready' as const, result: { start: 0, suggestions: [{ text: 'token' }] } }
  actor.send({ type: 'CLAUDE_PROMPT_COMPLETIONS', ...identity, mountId: 'foreign', result })
  expect(actor.getSnapshot().context.nativeUiViews.view?.completions).toBeUndefined()
  actor.send({ type: 'CLAUDE_PROMPT_COMPLETIONS', ...identity, result })
  expect(actor.getSnapshot().context.nativeUiViews.view?.completions).toEqual(result)
  actor.send({ type: 'CLAUDE_PROMPT_EDIT', ...identity, revision: 2, by: 'person', text: 'toke', cursor: 4 })
  actor.send({ type: 'CLAUDE_PROMPT_COMPLETIONS', ...identity, result })
  expect(actor.getSnapshot().context.nativeUiViews.view?.completions).toBeUndefined()
  actor.send({ type: 'CLAUDE_UI_UNMOUNT', ...identity })
  actor.send({ type: 'CLAUDE_PROMPT_COMPLETIONS', ...identity, result })
  expect(actor.getSnapshot().context.nativeUiViews.view).toBeUndefined()
  actor.stop()
})


it('rejects foreign and superseded focus and clears a pending redirect when the person moves again', () => {
  const actor = createActor(threadsState).start(), identity = { mountId: 'view', threadId: 'thread' }
  actor.send({ type: 'CLAUDE_UI_MOUNT', promptFocused: true, ...identity })
  const focus = { type: 'CLAUDE_UI_FOCUS' as const, ...identity, revision: 1, isHeld: true, focusId: 'one', by: 'person' as const }
  actor.send(focus); actor.send({ ...focus, revision: 2, focusId: 'two' })
  const reply = { type: 'CLAUDE_UI_FOCUS_STATE' as const, ...identity, result: { revision: 1, moved: true, focusId: 'old' } }
  actor.send(reply); expect(actor.getSnapshot().context.nativeUiViews.view?.focus).toBeUndefined()
  actor.send({ ...reply, threadId: 'foreign', result: { ...reply.result, revision: 2 } }); expect(actor.getSnapshot().context.nativeUiViews.view?.focus).toBeUndefined()
  actor.send({ ...reply, result: { revision: 2, moved: true, focusId: 'redirect' } }); expect(actor.getSnapshot().context.nativeUiViews.view?.focus?.focusId).toBe('redirect')
  actor.send({ ...focus, revision: 3, isHeld: false }); expect(actor.getSnapshot().context.nativeUiViews.view?.focus).toBeUndefined()
  actor.send({ type: 'CLAUDE_UI_UNMOUNT', ...identity }); actor.send(reply); expect(actor.getSnapshot().context.nativeUiViews).toEqual({})
  actor.stop()
})


it('routes only the current prompt host response and retires requests when the owner disconnects', () => {
  const actor = createActor(threadsState).start(), identity = { mountId: 'view', threadId: 'thread' }
  actor.send({ type: 'CLAUDE_UI_MOUNT', promptFocused: true, ...identity })
  const request = { requestId: 'request', revision: 1, expiresAt: Date.now() + 3000, kind: 'read' as const }
  actor.send({ type: 'CLAUDE_PROMPT_HOST_REQUEST', ...identity, threadId: 'foreign', request })
  expect(actor.getSnapshot().context.nativeUiViews.view?.promptHostRequest).toBeUndefined()
  actor.send({ type: 'CLAUDE_PROMPT_HOST_REQUEST', ...identity, request })
  actor.send({ type: 'CLAUDE_PROMPT_HOST_RESPONSE', ...identity, requestId: 'foreign', kind: 'read', box: { text: 'wrong', cursor: 0 } })
  expect(actor.getSnapshot().context.nativeUiViews.view?.promptHostRequest).toEqual(request)
  actor.send({ type: 'CLAUDE_PROMPT_HOST_RESPONSE', ...identity, requestId: request.requestId, kind: 'fill', filled: true })
  expect(actor.getSnapshot().context.nativeUiViews.view?.promptHostRequest).toEqual(request)
  actor.send({ type: 'CLAUDE_UI_STATE', resumeKey, ...identity, state: { status: 'disconnected' } })
  expect(actor.getSnapshot().context.nativeUiViews.view?.promptHostRequest).toBeUndefined()
  actor.stop()
})

it('forwards an Agent input once for its mounted thread and refuses foreign or retired slots', () => {
  const actor = createActor(threadsState).start(), identity = { mountId: 'agent-view', threadId: 'thread' }
  actor.send({ type: 'CLAUDE_UI_MOUNT', promptFocused: true, ...identity, nativeView: { ownerId: 'owner', sessionId: 'session', revision: 2, taskId: 'agent' } })
  sent.mockClear()
  const input = { type: 'CLAUDE_UI_AGENT_INPUT' as const, ...identity, revision: 1, text: 'User reply' }
  actor.send({ ...input, threadId: 'foreign' }); actor.send(input)
  actor.send({ type: 'CLAUDE_UI_UNMOUNT', ...identity }); actor.send({ ...input, revision: 2 })
  const inputs = sent.mock.calls.filter(call => JSON.stringify(call).includes('CLAUDE_UI_AGENT_INPUT'))
  expect(inputs).toHaveLength(1); expect(JSON.stringify(inputs)).toContain('User reply')
  actor.stop()
})

it('renews a native view using its issued credential and ignores an obsolete lease-expiry answer', () => {
  const actor = createActor(threadsState).start(), identity = { mountId: 'view', threadId: 'thread' }
  actor.send({ type: 'CLAUDE_UI_MOUNT', promptFocused: true, ...identity })
  actor.send({ type: 'CLAUDE_UI_STATE', ...identity, resumeKey, attachmentId: 'native-attachment', state: { status: 'live', tree: { kind: 'text', text: 'native' } } })
  sent.mockClear(); actor.send({ type: 'CLAUDE_UI_MOUNT', promptFocused: true, ...identity })
  expect(sent).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ type: 'CLAUDE_UI_MOUNT', promptFocused: true, resumeKey }) }))
  sent.mockClear(); actor.send({ type: 'CLAUDE_UI_LEASE_EXPIRED', ...identity, resumeKey: 'old-key' })
  expect(sent).not.toHaveBeenCalled(); expect(actor.getSnapshot().context.nativeUiViews.view?.resumeKey).toBe(resumeKey)
  actor.send({ type: 'CLAUDE_UI_LEASE_EXPIRED', ...identity, resumeKey })
  expect(actor.getSnapshot().context.nativeUiViews.view?.resumeKey).toBeUndefined()
  expect(sent).toHaveBeenLastCalledWith(expect.objectContaining({ event: expect.objectContaining({ type: 'CLAUDE_UI_MOUNT', promptFocused: true, resumeKey: undefined }) }))
  actor.stop()
})
it('resumes active native UI and terminal views on subscription startup without losing mount context', () => {
  const actor = createActor(threadsState).start(), mount = { type: 'CLAUDE_UI_MOUNT' as const, promptFocused: true, mountId: 'view', threadId: 'thread', messageIds: ['message'], userExpansion: { message: true } }
  actor.send(mount); actor.send({ type: 'CLAUDE_TERMINAL_MOUNT', threadId: 'thread', mountId: 'terminal' })
  actor.send({ type: 'CLAUDE_UI_STATE', mountId: 'view', threadId: 'thread', resumeKey, attachmentId: 'native', state: { status: 'live', tree: { kind: 'text', text: 'current' } } })
  sent.mockClear()
  actor.send({ type: 'THREAD_CONNECTED', data: { ...repository.threadQueries.connectedData(), settings: null } })
  expect(sent).toHaveBeenCalledWith(expect.objectContaining({ event: { ...mount, resumeKey } }))
  expect(sent).toHaveBeenCalledWith(expect.objectContaining({ event: { type: 'CLAUDE_TERMINAL_MOUNT', threadId: 'thread', mountId: 'terminal' } }))
  expect(actor.getSnapshot().context.nativeUiViews.view?.attachmentId).toBe('native')
  actor.stop()
})
it('carries the issued lease when a native view closes after its connection changes', () => {
  const actor = createActor(threadsState).start(), identity = { mountId: 'view', threadId: 'thread' }
  actor.send({ type: 'CLAUDE_UI_MOUNT', promptFocused: true, ...identity })
  actor.send({ type: 'CLAUDE_UI_STATE', ...identity, resumeKey, attachmentId: 'native', state: { status: 'live', tree: { kind: 'text', text: 'current' } } })
  sent.mockClear(); actor.send({ type: 'CLAUDE_UI_UNMOUNT', ...identity })
  expect(sent).toHaveBeenLastCalledWith(expect.objectContaining({ event: { type: 'CLAUDE_UI_UNMOUNT', ...identity, resumeKey } }))
  expect(actor.getSnapshot().context.nativeUiViews.view).toBeUndefined(); actor.stop()
})

it('defers replaced-actor cleanup to accepted startup data and drains it once', () => {
  takeClaudeUiRetirements(); sent.mockClear()
  const release = { threadId: 'thread-old', mountId: 'old-view', resumeKey }
  queueClaudeUiRetirement(release); queueClaudeUiRetirement(release)
  const actor = createActor(threadsState).start()
  expect(sent.mock.calls.filter(([message]) => message.event.type === 'CLAUDE_UI_UNMOUNT')).toHaveLength(0)
  const startup = { type: 'THREAD_CONNECTED' as const, data: { ...repository.threadQueries.connectedData(), settings: null } }
  actor.send(startup)
  expect(sent.mock.calls.filter(([message]) => message.event.type === 'CLAUDE_UI_UNMOUNT').map(([message]) => message.event)).toEqual([{ type: 'CLAUDE_UI_UNMOUNT', ...release }])
  actor.send(startup)
  expect(sent.mock.calls.filter(([message]) => message.event.type === 'CLAUDE_UI_UNMOUNT')).toHaveLength(1)
  queueClaudeUiRetirement({ ...release, mountId: 'late-old-view' })
  actor.send({ type: 'CLAUDE_UI_MOUNT', promptFocused: true, threadId: 'current-thread', mountId: 'new-view' })
  actor.send({ type: 'CLAUDE_UI_STATE', threadId: 'current-thread', mountId: 'new-view', resumeKey, state: { status: 'live', tree: { kind: 'text', text: 'ready' } } })
  expect(sent.mock.calls.filter(([message]) => message.event.type === 'CLAUDE_UI_UNMOUNT').map(([message]) => message.event.mountId)).toEqual(['old-view', 'late-old-view'])
  expect(takeClaudeUiRetirements()).toEqual([])
  actor.stop()
})


it('loads native permission phase on cold thread selection without overwriting a staged phase on refresh', () => {
  const edit = repository.threadCommands.create({topic:'Saved native edit',instructions:''})
  repository.threadCommands.update(edit.id,{context:{claudeCode:{sessionId:'saved-edit',permissionMode:'acceptEdits'}}})
  const plan = repository.threadCommands.create({topic:'Saved native plan',instructions:''})
  repository.threadCommands.update(plan.id,{context:{claudeCode:{sessionId:'saved-plan',permissionMode:'plan'}}})
  const actor = createActor(threadsState).start()
  actor.send({type:'LOAD_CHAT_THREAD',data:repository.chatQueries.threadData(edit.id)!})
  expect(actor.getSnapshot().context.phase).toBe('Edit')
  actor.send({type:'STAGE_CLAUDE_PHASE',phase:'Plan'})
  actor.send({type:'LOAD_CHAT_THREAD',data:repository.chatQueries.threadData(edit.id)!})
  expect(actor.getSnapshot().context.phase).toBe('Plan')
  actor.send({type:'LOAD_CHAT_THREAD',data:repository.chatQueries.threadData(plan.id)!})
  expect(actor.getSnapshot().context.phase).toBe('Plan')
  actor.send({type:'LOAD_CHAT_THREAD',data:{...repository.chatQueries.threadData(edit.id)!,forcedMode:'Claude Code'}})
  expect(actor.getSnapshot().context.phase).toBe('Plan')
  expect(actor.getSnapshot().context.phase).toBe('Plan')
  actor.send({type:'SET_PHASE',source:'native',threadId:edit.id,phase:'Edit'})
  expect(actor.getSnapshot().context.phase).toBe('Plan')
  const first = readClaudeComposerPhase(edit.id)!
  actor.send({type:'STAGE_CLAUDE_PHASE',phase:'Edit'})
  commitClaudeComposerPhase(edit.id,first.revision)
  expect(readClaudeComposerPhase(edit.id)?.phase).toBe('Edit')
  commitClaudeComposerPhase(edit.id,readClaudeComposerPhase(edit.id)!.revision)
  actor.send({type:'STAGE_CLAUDE_PHASE',phase:'Edit'})
  actor.send({type:'SET_PHASE',threadId:edit.id,phase:'Plan'})
  expect(actor.getSnapshot().context.phase).toBe('Plan')
  expect(readClaudeComposerPhase(edit.id)).toBeUndefined()
  actor.stop()
})


it('keeps a loaded native phase when startup hydration arrives later', () => {
  const thread = repository.threadCommands.create({topic:'Cold native',instructions:''})
  repository.threadCommands.update(thread.id,{context:{claudeCode:{sessionId:'saved',permissionMode:'default'}}})
  const data={...repository.chatQueries.threadData(thread.id)!,forcedMode:'Claude Code'}
  const actor=createActor(threadsState).start()
  actor.send({type:'LOAD_CHAT_THREAD',data})
  expect(actor.getSnapshot().context.phase).toBe('Edit')
  actor.send({type:'AGENT_CONNECTED',data:{currentThread:data,threads:[],recentThreads:[],tabs:[]}})
  expect(actor.getSnapshot().context.phase).toBe('Edit')
  actor.stop()
})

it('passes the selected phase to an explicit print Send and retires leftover native staging',()=>{
 const thread=repository.threadCommands.create({topic:'Return to print',instructions:''})
 repository.threadCommands.update(thread.id,{context:{claudeCode:{sessionId:'saved-plan',permissionMode:'plan'}}})
 const actor=createActor(threadsState).start()
 actor.send({type:'LOAD_CHAT_THREAD',data:repository.chatQueries.threadData(thread.id)!})
 actor.send({type:'STAGE_CLAUDE_PHASE',phase:'Edit'})
 expect(readClaudeComposerPhase(thread.id)?.phase).toBe('Edit')
 sent.mockClear();actor.send({type:'SEND_MESSAGE',text:'Continue in print Edit'})
 expect(sent).toHaveBeenCalledWith(expect.objectContaining({event:expect.objectContaining({type:'USER_MSG',threadId:thread.id,phase:'Edit',text:'Continue in print Edit'})}))
 expect(readClaudeComposerPhase(thread.id)).toBeUndefined();expect(actor.getSnapshot().context.phase).toBe('Edit');actor.stop()
})
