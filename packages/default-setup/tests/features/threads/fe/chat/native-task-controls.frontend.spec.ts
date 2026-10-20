import { createApp, h, ref, computed, provide, nextTick, type App } from 'vue'
import NativeTaskControls from '#extensions/blocks/display/NativeTaskControls.vue'
import { claudeTaskControls } from '#extensions/blocks/display/native-task-controls.ts'
import type { ClaudeTerminalTaskState } from '#features/threads/be/claude-terminal-views.ts'
let app: App | undefined
afterEach(() => { app?.unmount(); document.body.replaceChildren() })
async function fixture() {
  const task = { id: 'agent', ownerId: 'owner', sessionId: 'session', status: 'running' }
  const state = ref<ClaudeTerminalTaskState>({ ownerId: 'owner', taskId: 'agent', revision: 1, operation: 'inspect', status: 'done', details: { taskId: 'agent', name: 'Worker', status: 'running', canMessage: true, canInput: false, messages: [], truncated: false } })
  let revision = 1
  const operate = vi.fn(() => ++revision), root = document.createElement('div'); document.body.append(root)
  app = createApp({ setup() { provide(claudeTaskControls, { foregroundAvailable: computed(() => true), ownerId: computed(() => 'owner'), state: computed(() => state.value), operate }); return () => h(NativeTaskControls, { task }) } }); app.mount(root)
  ;[...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'View Agent conversation')!.click(); await nextTick()
  const input = root.querySelector<HTMLTextAreaElement>('textarea')!
  async function type(text: string) { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick() }
  async function send() { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await nextTick() }
  return { root, input, state, operate, type, send }
}
it('retains an unsent message when native delivery is refused', async () => {
  const f = await fixture(); await f.type('User instruction'); await f.send()
  expect(f.operate).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'agent', ownerId: 'owner' }), 'send', 'User instruction')
  f.state.value = { ...f.state.value, revision: 3, operation: 'send', status: 'error', problem: 'Native refusal' }; await nextTick()
  expect(f.input.value).toBe('User instruction'); expect(f.root.querySelector('[role="alert"]')?.textContent).toBe('Native refusal')
})
it('clears only the submitted text after its exact receipt and preserves typing during delivery', async () => {
  const f = await fixture(); await f.type('First instruction'); await f.send(); await f.type('New unsent text')
  f.state.value = { ...f.state.value, revision: 3, operation: 'send', status: 'done', sent: true }; await nextTick()
  expect(f.input.value).toBe('New unsent text')
  await f.send(); f.state.value = { ...f.state.value, revision: 4, operation: 'send', status: 'done', sent: true }; await nextTick()
  expect(f.input.value).toBe(''); expect(f.root.textContent).toContain('Message sent to Agent')
})

it('closes only the task conversation on Escape and preserves its unsent text', async () => {
  const f = await fixture(); await f.type('Unsent Agent instruction'); f.input.focus()
  const composing = new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }); f.input.dispatchEvent(composing); await nextTick()
  expect(f.root.querySelector('textarea')).toBe(f.input)
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); f.input.dispatchEvent(escape); await nextTick()
  expect(escape.defaultPrevented).toBe(true); expect(f.root.querySelector('textarea')).toBeNull()
  const toggle = [...f.root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'View Agent conversation')!; expect(document.activeElement).toBe(toggle)
  toggle.click(); await nextTick(); expect(f.root.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Unsent Agent instruction')
})

it('shows original native detail values, failed status and explicit shortened previews', async () => {
  const f = await fixture()
  f.state.value = { ...f.state.value, details: { ...f.state.value.details!, status: 'failed', metadata: { prompt: 'Original task prompt', promptTruncated: true, model: 'native-model', effort: 'high', elapsedMs: 4500, tokenCount: 0, toolUseCount: 4, error: 'Native failure', errorTruncated: true } } }; await nextTick()
  const details = f.root.querySelector('[aria-label="Agent details"]')!
  expect(details.textContent).toContain('native-model'); expect(details.textContent).toContain('high'); expect(details.textContent).toContain('4s'); expect(details.textContent).toContain('Tokens0'); expect(details.textContent).toContain('Tools4')
  expect(f.root.querySelector('summary')?.textContent).toBe('Agent prompt')
  expect(f.root.querySelector('details')?.textContent).toContain('Original task prompt')
  expect(f.root.textContent).toContain('Prompt preview shortened.'); expect(f.root.querySelector('[role="alert"]')?.textContent).toContain('Native failure')
})

it('uses human replies when supported and clears only their exact queued receipt', async () => {
  const f = await fixture(); f.state.value.details!.canInput = true; await nextTick()
  expect(f.input.getAttribute('aria-label')).toBe('Reply to this Agent')
  await f.type('Human reply'); await f.send()
  expect(f.operate).toHaveBeenLastCalledWith(expect.anything(), 'input', 'Human reply')
  f.state.value = { ...f.state.value, operation: 'input', revision: 3, status: 'done', input: { messageId: '12345678-1234-1234-1234-123456789abc', mode: 'resumed' } }; await nextTick()
  expect(f.input.value).toBe(''); expect(f.root.textContent).toContain('Agent resumed with your reply')
})

it('opens the bound native Agent through the app control', async () => {
  const f = await fixture()
  const open = [...f.root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Open Agent')!
  open.click(); await nextTick()
  expect(f.operate).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'agent', ownerId: 'owner', sessionId: 'session' }), 'foreground')
  f.state.value = { ownerId: 'owner', taskId: 'agent', revision: 2, operation: 'foreground', status: 'pending' }; await nextTick()
  expect(open.disabled).toBe(true)
})


it('preserves the complete attributed handback and warning as inert Agent output', async () => {
 const f=await fixture()
 const text='Release review complete.\n<script>window.bad=true</script>\nThe caller should review the migration notes.'
 f.state.value.details!.handback={taskId:'agent',text,warning:'Original native safety warning <img src=x onerror=bad()>'}
 await nextTick()
 const report=f.root.querySelector('[data-native-handback-task="agent"]')!
 expect(report.textContent).toContain(text)
 expect(report.querySelector('[role="alert"]')?.textContent).toContain('Original native safety warning <img src=x onerror=bad()>')
 expect(report.querySelector('script,img')).toBeNull()
 expect(report.textContent).toContain('From the delegated Agent')
})
