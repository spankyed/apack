import { ClaudePromptSource } from '#features/threads/fe/chat/native-prompt-source.ts'
import { Editor, Node, type Content } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { bindClaudeWindowDraft } from '#features/threads/fe/chat/native-window-draft.ts'
import { claudeWindowStorageKey } from '#features/threads/fe/chat/native-window-storage.ts'
import { captureClaudeAgentDraft, restoreClaudeAgentDraft } from '#features/threads/fe/chat/native-agent-draft.ts'

const reference = Node.create({ name: 'reference', group: 'inline', inline: true, atom: true,
  addAttributes: () => ({ id: { default: 'notes' }, retained: { default: 'parsed' } }), renderHTML: () => ['span', '@notes'],
  addStorage: () => ({ markdown: { serialize(state: { write(text: string): void }) { state.write('@notes') } } }),
})
const editors: Editor[] = []
const emptyParagraph = Node.create({ name: 'paragraph', priority: 1000, group: 'block', content: 'inline*', parseHTML: () => [{ tag: 'p' }], renderHTML: () => ['p', 0],
  addStorage: () => ({ markdown: { serialize(state: { write(text: string): void; renderInline(node: unknown): void; closeBlock(node: unknown): void }, node: { childCount: number }) { if (!node.childCount) state.write('&nbsp;'); else state.renderInline(node); state.closeBlock(node) }, parse: {} } }),
})
function create(content: Content, preserveEmpty = false) {
  const editor = new Editor({ extensions: [preserveEmpty ? StarterKit.configure({ paragraph: false }) : StarterKit, Markdown, reference, ClaudePromptSource, ...(preserveEmpty ? [emptyParagraph] : [])], content }); editors.push(editor); return editor
}
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy() })
const rich = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Review' }] },
  { type: 'codeBlock', attrs: { language: 'typescript' }, content: [{ type: 'text', text: 'const value = 1' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'hello ' }, { type: 'reference', attrs: { id: 'notes', retained: 'original identity' } }, { type: 'text', text: ' after', marks: [{ type: 'italic' }] }] },
] }
it('restores the structured document, reference attributes and selected text on a new editor', () => {
  const original = create(rich)
  original.view.dispatch(original.state.tr.setSelection(TextSelection.create(original.state.doc, 2, 5)))
  const snapshot = captureClaudeAgentDraft(original)!, before = JSON.stringify(snapshot)
  const next = create(snapshot.text)
  expect(next.getJSON()).not.toEqual(snapshot.doc)
  expect(restoreClaudeAgentDraft(next, snapshot, snapshot.text)).toBe(true)
  expect(next.getJSON()).toEqual(snapshot.doc)
  expect(next.state.selection.toJSON()).toEqual(snapshot.selection)
  expect(next.state.doc.textBetween(next.state.selection.from, next.state.selection.to)).toBe('evi')
  expect(JSON.stringify(snapshot)).toBe(before)
})
it('retains an atom selection instead of reconstructing it as a text cursor', () => {
  const original = create({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello ' }, { type: 'reference', attrs: { retained: 'original' } }] }] })
  original.view.dispatch(original.state.tr.setSelection(NodeSelection.create(original.state.doc, 7)))
  const snapshot = captureClaudeAgentDraft(original)!, next = create(snapshot.text)
  expect(restoreClaudeAgentDraft(next, snapshot, snapshot.text)).toBe(true)
  expect(next.state.selection).toBeInstanceOf(NodeSelection)
  expect((next.state.selection as NodeSelection).node.attrs.retained).toBe('original')
})
it('preserves typing marks and tags restoration as app adoption outside undo history', () => {
  const original = create('draft'); original.commands.setTextSelection(3)
  original.view.dispatch(original.state.tr.setStoredMarks([original.schema.marks.bold!.create()]))
  const snapshot = captureClaudeAgentDraft(original)!, next = create(snapshot.text), transactions: import('@tiptap/pm/state').Transaction[] = []
  next.on('transaction', ({ transaction }) => transactions.push(transaction))
  expect(restoreClaudeAgentDraft(next, snapshot, snapshot.text)).toBe(true)
  expect(next.state.storedMarks?.map(mark => mark.type.name)).toEqual(['bold'])
  expect(transactions.at(-1)?.getMeta('claude-prompt-by')).toBe('app')
  expect(transactions.at(-1)?.getMeta('addToHistory')).toBe(false)
})
it('refuses stale text, invalid structure or selections without changing the newer draft', () => {
  const original = create('old draft'), snapshot = captureClaudeAgentDraft(original)!, next = create('new draft')
  const current = next.getJSON()
  expect(restoreClaudeAgentDraft(next, snapshot, 'new draft')).toBe(false)
  expect(restoreClaudeAgentDraft(next, { ...snapshot, text: 'new draft' }, 'new draft')).toBe(false)
  const fresh = captureClaudeAgentDraft(next)!
  expect(restoreClaudeAgentDraft(next, { ...fresh, selection: { type: 'text', anchor: 999, head: 1000 } }, fresh.text)).toBe(false)
  expect(next.getJSON()).toEqual(current)
})
it('leaves an active composition alone', () => {
  const original = create('draft'), snapshot = captureClaudeAgentDraft(original)!
  Object.defineProperty(original.view, 'composing', { configurable: true, value: true })
  expect(captureClaudeAgentDraft(original)).toBeUndefined()
  expect(restoreClaudeAgentDraft(original, snapshot, snapshot.text)).toBe(false)
  expect(original.state.doc.textContent).toBe('draft')
})
it('keeps an empty Agent draft canonical through remount', () => {
  const original = create('draft'); original.commands.clearContent()
  const snapshot = captureClaudeAgentDraft(original)!
  expect(snapshot.text).toBe('')
  const next = create(snapshot.text)
  expect(restoreClaudeAgentDraft(next, snapshot, '')).toBe(true)
  expect(next.isEmpty).toBe(true)
})
it('does not save the app serializer empty-paragraph marker as Agent draft content', () => {
  const original = create('draft', true); original.commands.clearContent()
  const snapshot = captureClaudeAgentDraft(original)!
  expect(snapshot.text).toBe('')
  const next = create(snapshot.text, true)
  expect(restoreClaudeAgentDraft(next, snapshot, '')).toBe(true)
  expect(next.isEmpty).toBe(true)
})
it('retains a deliberate nonbreaking space that is actual document content', () => {
  const original = create({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\u00a0' }] }] }, true)
  expect(captureClaudeAgentDraft(original)!.text).not.toBe('')
})

it('retains a parent document and selection across frontend replacement as app input', async () => {
  const owner = crypto.randomUUID(), original = create(rich)
  await new Promise(resolve => original.on('create', resolve))
  const dispose = bindClaudeWindowDraft(original, owner)
  original.commands.setTextSelection({ from: 2, to: 5 })
  const snapshot = captureClaudeAgentDraft(original)!
  dispose(); original.destroy()
  const next = create(''), transactions: import('@tiptap/pm/state').Transaction[] = []
  next.on('transaction', ({ transaction }) => transactions.push(transaction))
  const detach = bindClaudeWindowDraft(next, owner)
  await new Promise(resolve => next.on('create', resolve))
  expect(next.getJSON()).toEqual(snapshot.doc); expect(next.state.selection.toJSON()).toEqual(snapshot.selection)
  expect(transactions.filter(transaction => transaction.docChanged).every(transaction => transaction.getMeta('claude-prompt-by') === 'app')).toBe(true)
  next.commands.clearContent(); detach()
  const cleared = create(''), stop = bindClaudeWindowDraft(cleared, owner)
  await new Promise(resolve => cleared.on('create', resolve))
  expect(cleared.isEmpty).toBe(true); stop()
})
it('isolates window draft owners and keeps an existing current document', async () => {
  const owner = crypto.randomUUID(), original = create('retained draft')
  await new Promise(resolve => original.on('create', resolve))
  bindClaudeWindowDraft(original, owner)()
  const other = create(''), existing = create('newer current draft')
  const stopOther = bindClaudeWindowDraft(other, crypto.randomUUID()), stopCurrent = bindClaudeWindowDraft(existing, owner)
  await Promise.all([new Promise(resolve => other.on('create', resolve)), new Promise(resolve => existing.on('create', resolve))])
  expect(other.isEmpty).toBe(true); expect(existing.state.doc.textContent).toBe('newer current draft')
  stopOther(); stopCurrent()
})


it('restores persisted structured input without any in-memory owner and clears it after submission', async () => {
  const owner = crypto.randomUUID(), original = create(rich)
  await new Promise(resolve => original.on('create', resolve)); original.commands.setTextSelection({from:2,to:5})
  const snapshot = captureClaudeAgentDraft(original)!, key = claudeWindowStorageKey('parent-draft', owner)!
  localStorage.setItem(`default-setup/threads:${key}`,JSON.stringify(snapshot))
  const restored = create(''), detach = bindClaudeWindowDraft(restored,owner)
  await new Promise(resolve => restored.on('create',resolve))
  expect(restored.getJSON()).toEqual(snapshot.doc); expect(restored.state.selection.toJSON()).toEqual(snapshot.selection)
  expect(claudeWindowStorageKey('parent-draft', owner,'?popout=surface&surfaceId=default-setup/threads')).not.toBe(key)
  restored.commands.clearContent(); detach(); expect(localStorage.getItem(`default-setup/threads:${key}`)).toBeNull()
})

it('restores exact literal source and its hidden-syntax caret only during untouched editor initialization', () => {
  const text = '  Worker review\n\n~~~~ts\nconst ready = true\n~~~~  '
  const original = create({ type: 'doc', content: [{ type: 'claudePromptSource', content: [{ type: 'text', text }] }] })
  original.commands.setTextSelection(text.indexOf('~~~~') + 2)
  const snapshot = captureClaudeAgentDraft(original)!, next = create(snapshot.text), initialDocument = next.state.doc
  expect(captureClaudeAgentDraft(next)!.text).not.toBe(snapshot.text)
  expect(restoreClaudeAgentDraft(next, snapshot, snapshot.text)).toBe(false)
  expect(restoreClaudeAgentDraft(next, snapshot, snapshot.text, initialDocument)).toBe(true)
  expect(next.getJSON()).toEqual(snapshot.doc)
  expect(next.state.selection.toJSON()).toEqual(snapshot.selection)
})

it('preserves newer typing instead of applying an initial literal snapshot after creation', () => {
  const text = '  raw source  '
  const original = create({ type: 'doc', content: [{ type: 'claudePromptSource', content: [{ type: 'text', text }] }] })
  const snapshot = captureClaudeAgentDraft(original)!, next = create(snapshot.text), initialDocument = next.state.doc
  next.commands.insertContent('newer ')
  const newer = next.getJSON()
  expect(restoreClaudeAgentDraft(next, snapshot, snapshot.text, initialDocument)).toBe(false)
  expect(next.getJSON()).toEqual(newer)
})

it('retains parent selection and typing marks after programmatic focus installs a default caret',async()=>{
 const editor=create('retained parent draft');document.body.append(editor.view.dom);editor.view.dom.tabIndex=0
 editor.commands.setTextSelection(8);editor.view.dispatch(editor.state.tr.setStoredMarks([editor.schema.marks.bold!.create()]))
 const selection=editor.state.selection.toJSON(),stop=bindClaudeWindowDraft(editor,'focus-parent-programmatic')
 editor.view.dom.addEventListener('focus',()=>{editor.commands.setTextSelection(1)},{once:true})
 editor.view.dom.focus();await Promise.resolve()
 expect(editor.state.selection.toJSON()).toEqual(selection);expect(editor.state.storedMarks?.map(mark=>mark.type.name)).toEqual(['bold'])
 stop();editor.view.dom.remove()
})
it('leaves pointer-selected parent positions and disposed focus work untouched',async()=>{
 const editor=create('retained parent draft');document.body.append(editor.view.dom);editor.view.dom.tabIndex=0
 editor.commands.setTextSelection(8);const stop=bindClaudeWindowDraft(editor,'focus-parent-pointer')
 editor.view.dom.dispatchEvent(new Event('pointerdown',{bubbles:true}));editor.view.dom.focus();editor.commands.setTextSelection(2);await Promise.resolve()
 expect(editor.state.selection.from).toBe(2)
 editor.view.dom.blur();editor.commands.setTextSelection(9);editor.view.dom.focus();stop();editor.commands.setTextSelection(4);await Promise.resolve()
 expect(editor.state.selection.from).toBe(4);editor.view.dom.remove()
})
