import { createClaudeActionKeyHandler, type ClaudeActionKeyResult } from '#features/threads/fe/chat/native-action-keys.ts'
import type { ClaudeUiMountState } from '#generated/types.ts'

type Keys = NonNullable<ClaudeUiMountState['actionKeys']>
const key = (name: string, ctrl = false) => ({ key: name, ctrl, alt: false, meta: false, shift: false, super: false })
function fixture() {
  const root = document.createElement('div'), editor = document.createElement('div'), button = document.createElement('button')
  editor.className = 'composer-document'; editor.setAttribute('contenteditable', 'true')
  button.dataset.nativePlugin = 'review'
  root.append(editor, button); document.body.append(root)
  const state: { scope?: string; keys?: Keys; result?: ClaudeActionKeyResult } = { scope: 'main:attachment', keys: { revision: 'a'.repeat(64), bindings: [[key('k', true), key('u')]], continuations: [], pending: null } }
  const send = vi.fn(), handle = createClaudeActionKeyHandler(() => state, send)
  root.addEventListener('keydown', event => handle(event, root), true)
  const fire = (name: string, options: KeyboardEventInit = {}, target: HTMLElement = editor) => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options })
    target.dispatchEvent(event); return event
  }
  return { root, editor, button, state, send, fire, handle }
}
afterEach(() => document.body.replaceChildren())

it('preserves ordinary typing, bare composer bindings, IME and unrelated controls', () => {
  const f = fixture()
  f.state.keys!.bindings.push([key('q')])
  expect(f.fire('q').defaultPrevented).toBe(false)
  expect(f.fire('k', { ctrlKey: true, isComposing: true }).defaultPrevented).toBe(false)
  const input = document.createElement('input'); input.dataset.nativePlugin = 'field'; f.root.append(input)
  expect(f.fire('k', { ctrlKey: true }, input).defaultPrevented).toBe(false)
  const client = document.createElement('div'); client.dataset.nativeClient = 'client'; client.append(f.button); f.root.append(client)
  expect(f.fire('k', { ctrlKey: true }, f.button).defaultPrevented).toBe(false)
  expect(f.send).not.toHaveBeenCalled()
})

it('sends a rapid complete chord in order without waiting for native replies', () => {
  const f = fixture()
  expect(f.fire('k', { ctrlKey: true }).defaultPrevented).toBe(true)
  expect(f.fire('u').defaultPrevented).toBe(true)
  expect(f.fire('x').defaultPrevented).toBe(false)
  expect(f.send.mock.calls.map(([request]) => [request.sequence, request.event.key])).toEqual([[1, 'k'], [2, 'u']])
  expect(f.editor.textContent).toBe('')
})

it('reconciles an early prefix acknowledgement without replaying a completed queued prefix', () => {
  const f = fixture()
  f.fire('k', { ctrlKey: true }); f.fire('u')
  f.state.result = { sequence: 1, handled: true, actionKeys: { ...f.state.keys!, pending: [key('k', true)] } }
  expect(f.fire('x').defaultPrevented).toBe(false)
  f.state.keys = { ...f.state.keys!, pending: null }
  f.state.result = { sequence: 2, handled: true, actionKeys: f.state.keys }
  expect(f.fire('x').defaultPrevented).toBe(false)
  expect(f.send).toHaveBeenCalledTimes(2)
})

it('cancels a pending chord once and leaves subsequent normal input available', () => {
  const f = fixture()
  f.fire('k', { ctrlKey: true })
  expect(f.fire('Escape').defaultPrevented).toBe(true)
  expect(f.fire('u').defaultPrevented).toBe(false)
  expect(f.send.mock.calls[1]![0].event.key).toBe('escape')
})

it.each(['binding', 'view'] as const)('retires predicted prefixes when the %s changes', change => {
  const f = fixture()
  f.fire('k', { ctrlKey: true })
  if (change === 'binding') f.state.keys = { ...f.state.keys!, revision: 'b'.repeat(64) }
  else f.state.scope = 'agent:replacement'
  f.state.result = { sequence: 1, handled: true, actionKeys: { revision: 'a'.repeat(64), bindings: [], continuations: [], pending: [key('k', true)] } }
  expect(f.fire('u').defaultPrevented).toBe(false)
  expect(f.send).toHaveBeenCalledOnce()
})

it('distinguishes Command from Alt and normalizes shifted punctuation like native key events', () => {
  const f = fixture()
  f.state.keys!.bindings = [[{ ...key('p'), super: true }], [{ ...key('!'), alt: true }]]
  expect(f.fire('p', { altKey: true }).defaultPrevented).toBe(false)
  expect(f.fire('p', { metaKey: true }).defaultPrevented).toBe(true)
  expect(f.send.mock.calls[0]![0].event).toMatchObject({ key: 'p', super: true, alt: false })
  expect(f.fire('!', { altKey: true, shiftKey: true }).defaultPrevented).toBe(true)
  expect(f.send.mock.calls[1]![0].event).toMatchObject({ key: '!', shift: false, alt: true })
})

it('withdraws key handling when native bindings disappear and honors prior event cancellation', () => {
  const f = fixture()
  f.editor.addEventListener('keydown', event => event.preventDefault(), true)
  const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }); event.preventDefault()
  f.editor.dispatchEvent(event); expect(f.send).not.toHaveBeenCalled()
  f.state.keys = undefined
  f.fire('k', { ctrlKey: true }); expect(f.send).not.toHaveBeenCalled()
})


it('cancels an app-owned prefix when focus leaves, while retaining it for movement inside the view', () => {
  const f = fixture()
  f.fire('k', { ctrlKey: true })
  f.handle.leave(new FocusEvent('focusout', { relatedTarget: f.button }), f.root)
  expect(f.send).toHaveBeenCalledOnce()
  f.handle.leave(new FocusEvent('focusout'), f.root)
  expect(f.send.mock.calls[1]![0].event.key).toBe('escape')
  f.handle.cancel(); expect(f.send).toHaveBeenCalledTimes(2)
  expect(f.fire('u').defaultPrevented).toBe(false)
})
