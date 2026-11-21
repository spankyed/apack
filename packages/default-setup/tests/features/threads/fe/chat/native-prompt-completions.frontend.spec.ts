import { createApp, h, nextTick, shallowReactive, type App } from 'vue'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Plugin } from '@tiptap/pm/state'
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'
import { commandSuggestionKey } from '@apackdev/ui/components/tiptap/extensions/command-suggestion'
import { referenceSuggestionKey } from '#extensions/tiptap/reference-suggestion.ts'
import NativePromptCompletions from '#features/threads/fe/chat/NativePromptCompletions.vue'
let app: App | undefined
const editors: Editor[] = []
beforeEach(() => { startFeTestRuntime(); HTMLElement.prototype.scrollIntoView = vi.fn(); Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList); Range.prototype.getBoundingClientRect = vi.fn(() => new DOMRect()) })
afterEach(() => { app?.unmount(); app = undefined; for (const editor of editors.splice(0)) editor.destroy(); document.body.replaceChildren(); stopFeTestRuntime() })
async function mount() {
  const editor = new Editor({ extensions: [StarterKit], content: 'Draft #release' }); editors.push(editor)
  const root = document.createElement('div'); document.body.append(root, editor.view.dom)
  const state = shallowReactive({ editor, disabled: false, rows: [{ text: '#release-public', label: 'Public release', description: 'Notes for customers', offerId: 'offer-one' }, { text: '#release-internal', label: 'Internal release', description: 'Notes for teammates', offerId: 'offer-one' }] })
  const select = vi.fn(), dismiss = vi.fn()
  app = createApp({ render: () => h(NativePromptCompletions, { ...state, onSelect: select, onDismiss: dismiss }) }); app.mount(root); await nextTick()
  editor.view.dom.focus()
  const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="Claude suggestions"] button'))
  return { editor, root, state, select, dismiss, buttons }
}
const key = (target: HTMLElement, name: string, options: KeyboardEventInit = {}) => { const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options }); target.dispatchEvent(event); return event }
it('shows native labels and descriptions without selecting or changing the draft', async () => {
  const f = await mount()
  expect(f.buttons().map(button => button.textContent)).toEqual(['Public releaseNotes for customers', 'Internal releaseNotes for teammates'])
  expect(document.activeElement).toBe(f.editor.view.dom); expect(f.select).not.toHaveBeenCalled(); expect(f.editor.state.doc.textContent).toBe('Draft #release')
})
it('enters from the editor with arrows, navigates rows and dismisses back to the same caret', async () => {
  const f = await mount(), doc = f.editor.state.doc, selection = f.editor.state.selection
  expect(key(f.editor.view.dom, 'ArrowDown').defaultPrevented).toBe(true); expect(document.activeElement).toBe(f.buttons()[0])
  key(f.buttons()[0]!, 'End'); expect(document.activeElement).toBe(f.buttons()[1])
  key(f.buttons()[1]!, 'Home'); expect(document.activeElement).toBe(f.buttons()[0])
  key(f.buttons()[0]!, 'ArrowUp'); expect(document.activeElement).toBe(f.buttons()[1])
  key(f.buttons()[1]!, 'Escape'); expect(f.dismiss).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(f.editor.view.dom)
  expect(f.editor.state.doc).toBe(doc); expect(f.editor.state.selection.eq(selection)).toBe(true); expect(f.select).not.toHaveBeenCalled()
})
it('selects the exact current offer by pointer without submitting the form', async () => {
  const f = await mount(); f.buttons()[1]!.click()
  expect(f.select).toHaveBeenCalledExactlyOnceWith(1, 'offer-one'); expect(f.editor.state.doc.textContent).toBe('Draft #release')
})
it.each([{ isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }])('preserves composition and modified editor keys %j', async options => {
  const f = await mount(); key(f.editor.view.dom, 'ArrowDown', options)
  expect(document.activeElement).toBe(f.editor.view.dom); expect(f.select).not.toHaveBeenCalled(); expect(f.dismiss).not.toHaveBeenCalled()
})
it.each(['command', 'reference'] as const)('defers to an active app %s popup', async kind => {
  const f = await mount()
  if (kind === 'command') f.editor.registerPlugin(new Plugin({ key: commandSuggestionKey, state: { init: () => ({ active: true, query: 'release', selectedCommand: null, previousCommand: null }), apply: (_tr, state) => state } }))
  else f.editor.registerPlugin(new Plugin({ key: referenceSuggestionKey, state: { init: () => ({ active: true, query: 'release', triggerPos: 1, level: 'category' as const, selectedCategory: null, categoryQuery: '' }), apply: (_tr, state) => state } }))
  f.editor.view.dispatch(f.editor.state.tr); await nextTick()
  expect(f.buttons()).toHaveLength(0); key(f.editor.view.dom, 'ArrowDown'); expect(f.select).not.toHaveBeenCalled()
})
it('withdraws focused stale rows before showing a replacement offer', async () => {
  const f = await mount(); key(f.editor.view.dom, 'ArrowDown')
  f.state.rows = [{ text: '#fresh', label: 'Fresh choice', description: 'Current offer', offerId: 'offer-two' }]; await nextTick()
  expect(document.activeElement).toBe(f.editor.view.dom); expect(f.select).not.toHaveBeenCalled()
  f.buttons()[0]!.click(); expect(f.select).toHaveBeenCalledExactlyOnceWith(0, 'offer-two')
})
it('withdraws disabled rows and removes keyboard ownership on unmount', async () => {
  const f = await mount(); f.state.disabled = true; await nextTick(); expect(f.buttons()).toHaveLength(0)
  f.state.disabled = false; await nextTick(); app!.unmount(); app = undefined
  key(f.editor.view.dom, 'ArrowDown'); expect(f.select).not.toHaveBeenCalled(); expect(f.dismiss).not.toHaveBeenCalled()
})

it('keeps Tab focus movement inside the list out of parent composer shortcuts', async () => {
  const f = await mount(), parent = vi.fn(); f.root.addEventListener('keydown', parent)
  key(f.editor.view.dom, 'ArrowDown')
  const event = key(f.buttons()[0]!, 'Tab', { shiftKey: true })
  expect(event.defaultPrevented).toBe(false); expect(parent).not.toHaveBeenCalled(); expect(f.select).not.toHaveBeenCalled(); expect(f.dismiss).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(f.editor.view.dom)
})
