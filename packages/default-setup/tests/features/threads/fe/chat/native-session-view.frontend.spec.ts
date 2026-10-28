import { createApp, h, ref, computed, nextTick, type App } from 'vue'
import type { ClaudeTerminalViewSnapshot } from '#features/threads/be/claude-terminal-views.ts'
import ClaudeNativeSession from '#features/threads/fe/chat/ClaudeNativeSession.vue'
const actor = vi.hoisted(() => ({ send: vi.fn() }))
const state = ref({ context: { nativeTerminalViews: {} as Record<string, ClaudeTerminalViewSnapshot> } })
vi.mock('@apackdev/sdk/fe', () => ({ useSurface: () => actor }))
vi.mock('@xstate/vue', () => ({ useSelector: (_actor: unknown, select: (value: typeof state.value) => unknown) => computed(() => select(state.value)) }))
vi.mock('#features/threads/fe/chat/native-terminal-pool.ts', () => ({ mountNativeTerminal: () => ({ detach: vi.fn(), focus: vi.fn(), fit: () => ({ columns: 100, rows: 30 }), write: vi.fn() }) }))
let app: App | undefined
beforeEach(() => { actor.send.mockClear(); state.value = { context: { nativeTerminalViews: {} } }; vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
afterEach(() => { app?.unmount(); document.body.replaceChildren(); vi.unstubAllGlobals() })
async function fixture() {
  const active = vi.fn(), root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(ClaudeNativeSession, { threadId: 'thread', busy: false, onActive: active }) }); app.mount(root)
  const mount = actor.send.mock.calls.find(([event]) => event.type === 'CLAUDE_TERMINAL_MOUNT')![0]
  const snapshot: ClaudeTerminalViewSnapshot = { opening: false, output: [], state: { ownerId: 'owner', sessionId: 'session', cwd: '/fixture', status: 'live', busy: false, tasks: [{ id: 'agent-a', name: 'Worker', status: 'running' }], view: { kind: 'agent', revision: 2, registryId: 'registry-a', taskId: 'agent-a' } } }
  function publish(value: ClaudeTerminalViewSnapshot) { state.value = { context: { nativeTerminalViews: { [mount.mountId]: { ...value, threadId: 'thread' } as ClaudeTerminalViewSnapshot } } } }
  publish(snapshot); await nextTick()
  root.querySelector<HTMLButtonElement>('button')!.click(); await nextTick()
  const back = Array.from(root.querySelectorAll('button')).find(button => button.textContent?.includes('Back to conversation'))!
  return { root, active, snapshot, publish, back }
}
it('keeps the native terminal visible until the exact main-view receipt is acknowledged', async () => {
  const f = await fixture(); expect(f.root.textContent).toContain('Viewing Agent · Worker')
  f.back.click(); await nextTick()
  const request = actor.send.mock.calls.at(-1)![0]
  expect(request).toMatchObject({ operation: 'background', taskId: 'agent-a', ownerId: 'owner', revision: 1 })
  expect(f.active).toHaveBeenLastCalledWith(true)
  const main = { ...f.snapshot.state!, view: { kind: 'main' as const, revision: 3 } }
  f.publish({ ...f.snapshot, state: main, task: { ownerId: 'owner', taskId: 'agent-a', revision: 2, operation: 'background', status: 'done', view: { taskId: null } } }); await nextTick()
  expect(f.active).toHaveBeenLastCalledWith(true)
  f.publish({ ...f.snapshot, state: main, task: { ownerId: 'owner', taskId: 'agent-a', revision: 1, operation: 'background', status: 'done', view: { taskId: null } } }); await nextTick()
  expect(f.active).toHaveBeenLastCalledWith(false)
})
it('retains the native terminal and reports a rejected return instead of exposing the parent composer', async () => {
  const f = await fixture(); f.back.click(); await nextTick()
  f.publish({ ...f.snapshot, task: { ownerId: 'owner', taskId: 'agent-a', revision: 1, operation: 'background', status: 'error', problem: 'A different native Agent is selected' } }); await nextTick()
  expect(f.active).toHaveBeenLastCalledWith(true)
  expect(f.root.querySelector('[role="alert"]')?.textContent).toBe('A different native Agent is selected')
})

it('allows leaving an exited native owner even if a task receipt was still pending', async () => {
  const f = await fixture()
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, status: 'exited' }, task: { ownerId: 'owner', taskId: 'agent-a', revision: 1, operation: 'input', status: 'pending' } }); await nextTick()
  expect(f.back.disabled).toBe(false); f.back.click(); await nextTick()
  expect(f.active).toHaveBeenLastCalledWith(false)
})

it('shows the original billing notice in ordinary chat and sends its exact decision identity', async () => {
  const f = await fixture()
  const notice = { id: 'notice', revision: 'revision', sessionId: 'session', kind: 'auto_mode_server_fallback' as const, title: '<script>Original notice</script>', paragraphs: ['Original gateway explanation'], helpUrl: 'https://code.claude.com/docs/en/auto-mode-classifier-billing' }
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, status: 'exited' } }); await nextTick(); f.back.click(); await nextTick()
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, notice } }); await nextTick()
  const card = f.root.querySelector('[aria-label="Claude auto mode notice"]')!
  expect(card.textContent).toContain(notice.title); expect(card.querySelector('script')).toBeNull()
  const button = [...card.querySelectorAll('button')].find(button => button.textContent === 'Continue in auto mode')!
  button.click()
  expect(actor.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'CLAUDE_TERMINAL_NOTICE', ownerId: 'owner', notice: { id: 'notice', revision: 'revision', sessionId: 'session', decision: 'continue' } }))
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, notice }, noticeAnswer: { id: 'notice', revision: 'revision', status: 'pending' } }); await nextTick()
  expect([...card.querySelectorAll('button')].every(button => button.disabled)).toBe(true)
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, notice }, noticeAnswer: { id: 'notice', revision: 'revision', status: 'error', problem: 'Native notice changed' } }); await nextTick()
  expect(card.querySelector('[role="alert"]')?.textContent).toBe('Native notice changed')
  ;[...card.querySelectorAll('button')].find(button => button.textContent === 'Cancel')!.click()
  expect(actor.send.mock.calls.at(-1)![0].notice.decision).toBe('interrupt')
})

it('exposes a scoped cancel action before owner state exists and keeps retry disabled while cleanup is pending', async () => {
 const f=await fixture(),openingId=crypto.randomUUID();
 f.publish({opening:true,openingId,output:[]});await nextTick();expect(f.active).toHaveBeenLastCalledWith(false);
 const cancel=[...f.root.querySelectorAll('button')].find(button=>button.textContent==='Cancel startup')!;
 expect(cancel).toBeTruthy();cancel.click();await nextTick();expect(actor.send).toHaveBeenLastCalledWith(expect.objectContaining({type:'CLAUDE_TERMINAL_CANCEL_OPEN',openingId}));
 f.publish({opening:true,openingId,cancelling:true,output:[]});await nextTick();expect(cancel.disabled).toBe(true);expect(f.root.textContent).toContain('Cancelling native startup…');
 f.publish({opening:false,output:[],problem:'Native startup cancelled'});await nextTick();
 const retry=[...f.root.querySelectorAll('button')].find(button=>button.textContent?.includes('Use native interface'))!;expect(retry.disabled).toBe(false);expect(f.active).toHaveBeenLastCalledWith(false);
});


it('explains unexpected failure beside reopen in ordinary conversation, while preserving specific native problems', async () => {
  const f = await fixture()
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, status: 'error', tasks: [] } }); await nextTick()
  f.back.click(); await nextTick()
  expect(f.active).toHaveBeenLastCalledWith(false)
  expect(f.root.querySelector('[role="status"]')?.textContent).toBe('Claude Code disconnected unexpectedly. Reopen the native interface to continue this session.')
  const reopen = [...f.root.querySelectorAll('button')].find(button => button.textContent?.includes('Use native interface'))!
  expect(reopen.disabled).toBe(false)
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, status: 'error', problem: 'Original native failure detail' } }); await nextTick()
  expect(f.root.querySelector('[role="status"]')?.textContent).toBe('Original native failure detail')
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, status: 'exited' } }); await nextTick()
  expect(f.root.querySelector('[role="status"]')).toBeNull()
})

it('shows all native LSP choices in ordinary chat, retires the card and sends no on Escape', async () => {
  const f = await fixture()
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, status: 'exited' } }); await nextTick(); f.back.click(); await nextTick()
  const notice = { id: 'lsp', revision: 'revision', sessionId: 'session', kind: 'lsp_recommendation' as const, pluginName: 'Review', marketplaceName: 'Owned', fileExtension: '.review', title: 'LSP plugin recommendation', paragraphs: ['Plugin: <b>Review</b>'], choices: (['yes', 'no', 'never', 'disable'] as const).map(value => ({ value, label: value })) }
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, notice } }); await nextTick()
  const card = f.root.querySelector('[aria-label="Claude LSP recommendation"]')!
  expect(card.querySelector('b')).toBeNull()
  expect([...card.querySelectorAll('.native-notice__actions button')].map(button => button.textContent)).toEqual(['yes', 'no', 'never', 'disable'])
  const about = [...card.querySelectorAll('button')].find(button => button.textContent === 'About this plugin')!
  about.click(); await nextTick()
  await vi.waitFor(() => expect(document.body.querySelector('[aria-label="LSP plugin details"]')).not.toBeNull())
  const details = document.body.querySelector('[aria-label="LSP plugin details"]')!
  expect(details.getAttribute('aria-labelledby')).toBe(about.id)
  expect(details.textContent).toContain('<b>Review</b>'); expect(details.querySelector('b')).toBeNull()
  details.querySelector<HTMLButtonElement>('button[aria-label="Close plugin details"]')!.click(); await nextTick()
  expect(actor.send.mock.calls.filter(([event]) => event.type === 'CLAUDE_TERMINAL_NOTICE')).toHaveLength(0)
  for (const button of [...card.querySelectorAll('button')].filter(button => button !== about)) {
    button.click()
    expect(actor.send.mock.calls.at(-1)![0].notice).toEqual({ id: 'lsp', revision: 'revision', sessionId: 'session', decision: button.textContent })
  }
  card.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(actor.send.mock.calls.at(-1)![0].notice.decision).toBe('no')
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, notice: undefined } }); await nextTick()
  expect(f.root.querySelector('[aria-label="Claude LSP recommendation"]')).toBeNull()
})


it('shows original shell plugin choices in chat and uses defer for Escape without an LSP-only action', async () => {
  const f = await fixture()
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, status: 'exited' } }); await nextTick(); f.back.click(); await nextTick()
  const notice = { id: 'hint', revision: 'revision', sessionId: 'session', kind: 'plugin_hint' as const, pluginName: 'Review', marketplaceName: 'Official', sourceCommand: '/usr/bin/printf', title: 'Plugin recommendation', paragraphs: ['The command suggests installing a plugin.'], choices: (['yes', 'no', 'disable'] as const).map(value => ({ value, label: value })) }
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, notice } }); await nextTick()
  const card = f.root.querySelector('[aria-label="Claude plugin recommendation"]')!
  expect(card.textContent).toContain('Review · Official')
  const buttons = [...card.querySelectorAll<HTMLButtonElement>('.native-notice__actions button')]
  expect(buttons.map(button => button.textContent)).toEqual(['yes', 'no', 'disable'])
  for (const button of buttons) {
    button.click()
    expect(actor.send.mock.calls.at(-1)![0].notice).toEqual({ id: 'hint', revision: 'revision', sessionId: 'session', decision: button.textContent })
  }
  buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(actor.send.mock.calls.at(-1)![0].notice.decision).toBe('no')
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, notice: undefined } }); await nextTick()
  expect(f.root.querySelector('[aria-label="Claude plugin recommendation"]')).toBeNull()
})

it('shows native refusal text and exact retry/edit/cancel decisions without plugin details', async () => {
  const f = await fixture()
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, status: 'exited' } }); await nextTick(); f.back.click(); await nextTick()
  const notice = { id: 'refusal', revision: 'revision', sessionId: 'session', kind: 'refusal_fallback_prompt' as const, originalModel: 'Opus 5', fallbackModel: 'Opus 4.8', title: 'Session paused', paragraphs: ['Original <b>refusal</b> explanation'], choices: [{ value: 'retry_fallback' as const, label: 'Retry on Opus 4.8' }, { value: 'edit_prompt' as const, label: 'Edit prompt' }] }
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, notice } }); await nextTick()
  const card = f.root.querySelector('[aria-label="Claude model fallback"]')!
  expect(card.textContent).toContain('Original <b>refusal</b> explanation'); expect(card.querySelector('b')).toBeNull()
  expect(card.textContent).not.toContain('About this plugin')
  const buttons = [...card.querySelectorAll<HTMLButtonElement>('.native-notice__actions button')]
  expect(buttons.map(button => button.textContent)).toEqual(['Retry on Opus 4.8', 'Edit prompt', 'Cancel'])
  for (const [index, decision] of ['retry_fallback', 'edit_prompt', 'cancelled'].entries()) {
    buttons[index]!.click()
    expect(actor.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'CLAUDE_TERMINAL_NOTICE', notice: { id: notice.id, revision: notice.revision, sessionId: notice.sessionId, decision } }))
  }
  card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(actor.send).toHaveBeenLastCalledWith(expect.objectContaining({ notice: expect.objectContaining({ decision: 'cancelled' }) }))
  f.publish({ ...f.snapshot, state: { ...f.snapshot.state!, notice }, noticeAnswer: { id: notice.id, status: 'pending', revision: notice.revision } }); await nextTick()
  expect(buttons.every(button => button.disabled)).toBe(true)
})
