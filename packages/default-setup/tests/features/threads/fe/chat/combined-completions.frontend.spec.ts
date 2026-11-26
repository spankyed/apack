import { createApp, h, nextTick, type App } from 'vue'
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'
import { Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Plugin } from '@tiptap/pm/state'
import CommandPopup from '@apackdev/ui/components/tiptap/CommandSuggestionPopup'
import ReferencePopup from '#extensions/tiptap/ReferenceSuggestionPopup.vue'
import { commandSuggestionKey } from '@apackdev/ui/components/tiptap/extensions/command-suggestion'
import { referenceSuggestionKey } from '#extensions/tiptap/reference-suggestion.ts'
import { setEditorCompletionOffer } from '@apackdev/sdk/fe'

const fixture = vi.hoisted(() => ({ empty: false }))
vi.mock('@apackdev/ui/components/tiptap/composables/useCommandItems', async () => {
  const { ref } = await import('vue')
  return { useCommandItems: () => ({ commands: ref(fixture.empty ? [] : [{ name: 'host-command', description: 'Host' }]) }) }
})
vi.mock('#extensions/tiptap/useReferenceItems.ts', async () => {
  const { ref } = await import('vue')
  return { useReferenceItems: () => ({ categories: ref(fixture.empty ? [] : [{ featureRef: 'test/notes', id: 'notes', declaration: { label: 'Notes' } }]), items: ref([]) }) }
})
let app: App, editor: Editor
beforeEach(() => { fixture.empty = false; startFeTestRuntime({ catalog: { status: () => 'ready', problem: () => undefined, frontend: () => [], artifacts: () => [], blocks: () => [], events: () => [], dsl: () => [], steps: () => [], references: () => [], subscribe: () => () => {} } }); HTMLElement.prototype.scrollIntoView = vi.fn() })
afterEach(() => { app?.unmount(); editor?.destroy(); document.body.replaceChildren(); stopFeTestRuntime() })

function mount(kind: 'command' | 'reference') {
  editor = new Editor({ extensions: [StarterKit], content: kind === 'command' ? '/h' : '@n' })
  if (kind === 'command') editor.registerPlugin(new Plugin({ key: commandSuggestionKey, state: { init: () => ({ active: true, query: 'h', selectedCommand: null, previousCommand: null }), apply: (_tr, state) => state } }))
  else editor.registerPlugin(new Plugin({ key: referenceSuggestionKey, state: { init: () => ({ active: true, query: 'n', triggerPos: 1, level: 'category' as const, selectedCategory: null, categoryQuery: '' }), apply: (_tr, state) => state } }))
  const select = vi.fn(() => true), dismiss = vi.fn()
  setEditorCompletionOffer(editor, { id: 'offer-one', rows: [{ text: 'native-result', label: 'Native row', select }], dismiss })
  const root = document.createElement('div'); document.body.append(root, editor.view.dom)
  app = createApp({ render: () => h(kind === 'command' ? CommandPopup : ReferencePopup, { editor }) }); app.mount(root)
  return { select, dismiss }
}

it.each(['command', 'reference'] as const)('appends native rows after %s rows without taking the initial selection', async kind => {
  const f = mount(kind); await nextTick()
  const popup = document.querySelector(kind === 'command' ? '.command-suggestion-popup' : '.reference-suggestion-popup')!
  expect(popup.textContent).toContain(kind === 'command' ? '/host-command' : 'Notes')
  const native = popup.querySelector('[data-native-completion-rows] button')!
  expect(native.textContent).toContain('Native row')
  expect(native.classList.contains('is-selected')).toBe(false)
  expect(popup.querySelector('.is-selected')?.textContent).toContain(kind === 'command' ? '/host-command' : 'Notes')
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); await nextTick()
  expect(native.classList.contains('is-selected')).toBe(true)
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  expect(f.select).toHaveBeenCalledOnce()
})

it('retires the native offer when escaping the host popup', async () => {
  const f = mount('command'); await nextTick()
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  expect(f.dismiss).toHaveBeenCalledOnce()
})


it.each(['command', 'reference'] as const)('leaves native rows unhighlighted when the %s list is empty', async kind => {
  fixture.empty = true
  const f = mount(kind); await nextTick()
  const row = document.querySelector('[data-native-completion-rows] button')!
  expect(row.classList.contains('is-selected')).toBe(false)
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); await nextTick()
  expect(row.classList.contains('is-selected')).toBe(true)
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  expect(f.select).toHaveBeenCalledOnce()
})
