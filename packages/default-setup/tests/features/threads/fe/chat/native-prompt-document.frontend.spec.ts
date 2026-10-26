import { claudePromptThemeStyle, claudeUiColor } from '#features/threads/fe/chat/native-ui-paint.ts'
import { Editor, Node } from '@tiptap/core'
import { createClaudePromptDecorations, drawClaudePromptDecorations } from '#features/threads/fe/chat/native-prompt-decorations.ts'
import { bindClaudePromptEditor } from '#features/threads/fe/chat/native-prompt-editor.ts'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { DOMParser as PromptDOMParser } from '@tiptap/pm/model'
import { captureClaudePromptDocument, findClaudePromptPosition, rewriteClaudePromptDocument } from '#features/threads/fe/chat/native-prompt-document.ts'

let editor: Editor
beforeEach(() => { editor = new Editor({ extensions: [StarterKit, Markdown] }) })
afterEach(() => editor.destroy())
const serialize = (doc: import('@tiptap/pm/model').Node): string => (editor.storage as unknown as { markdown: { serializer: { serialize(doc: import('@tiptap/pm/model').Node): string } } }).markdown.serializer.serialize(doc)

it('maps UTF-16 caret positions through Markdown marks, lists, code and paragraph separators', () => {
  for (const content of ['**hello** world', '- first\n- second', 'before `code` after', 'first\n\nsecond', 'emoji 😀 next']) {
    editor.commands.setContent(content)
    const doc = editor.state.doc
    let checked = 0
    doc.descendants((node, pos) => {
      if (!node.isText) return
      for (let index = 1; index < node.nodeSize; index++) {
        const snapshot = captureClaudePromptDocument(doc, pos + index, serialize)
        expect(snapshot, content).toBeDefined()
        expect(findClaudePromptPosition(doc, snapshot!.cursor, serialize)).toBe(pos + index)
        checked++
      }
    })
    expect(checked).toBeGreaterThan(0)
  }
})

it('rewrites ordinary text while preserving marks and refusing unrepresentable Markdown changes', () => {
  editor.commands.setContent('**hello** world')
  const snapshot = captureClaudePromptDocument(editor.state.doc, 3, serialize)!
  const result = rewriteClaudePromptDocument(snapshot, { text: '**HELLO** world', cursor: 5 }, serialize)
  expect(result).toBeDefined()
  expect(serialize(result!.doc)).toBe('**HELLO** world')
  expect(result!.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold')
  expect(rewriteClaudePromptDocument(snapshot, { text: '**hello** **world**', cursor: 15 }, serialize)).toBeUndefined()
  expect(editor.state.doc).toBe(snapshot.doc)
})

it('keeps reference atoms intact and refuses a rewrite through an atom', () => {
  editor.destroy()
  const reference = Node.create({ name: 'reference', group: 'inline', inline: true, atom: true,
    addAttributes: () => ({ id: { default: 'ref-id' }, label: { default: 'Note' } }),
    renderHTML: () => ['span', 'Note'],
    addStorage: () => ({ markdown: { serialize(state: { write(text: string): void }) { state.write('[Note](ref:ref-id)') } } }),
  })
  editor = new Editor({ extensions: [StarterKit, Markdown, reference], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello ' }, { type: 'reference' }, { type: 'text', text: ' after' }] }] } })
  const snapshot = captureClaudePromptDocument(editor.state.doc, 3, serialize)!
  const changed = rewriteClaudePromptDocument(snapshot, { text: snapshot.text.replace('hello', 'HELLO'), cursor: 3 }, serialize)!
  expect(changed.doc.firstChild?.child(1)).toBe(snapshot.doc.firstChild?.child(1))
  expect(rewriteClaudePromptDocument(snapshot, { text: 'gone', cursor: 4 }, serialize)).toBeUndefined()
})


it('adopts app drafts, routes person edits and applies only the latest owned native rewrite', () => {
  editor.commands.setContent('seed')
  const send = vi.fn(), problem = vi.fn()
  const bridge = bindClaudePromptEditor(editor, send, problem)
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ by: 'app', text: 'seed', cursor: 4 }))
  editor.view.dom.dispatchEvent(new Event('beforeinput', { bubbles: true }))
  editor.commands.insertContent('x')
  const request = send.mock.lastCall![0]
  expect(request).toMatchObject({ by: 'person', text: 'seedx', cursor: 5 })
  bridge.receive({ revision: request.revision, status: 'applied', frame: { text: 'SEEDX', cursor: 5 } })
  expect(serialize(editor.state.doc)).toBe('SEEDX')
  expect(send).toHaveBeenCalledTimes(2)
  editor.commands.insertContent('a')
  const old = send.mock.lastCall![0]
  editor.commands.insertContent('b')
  const latest = send.mock.lastCall![0]
  bridge.receive({ revision: old.revision, status: 'applied', frame: { text: 'old', cursor: 3 } })
  expect(serialize(editor.state.doc)).toBe('SEEDXab')
  bridge.receive({ revision: latest.revision, status: 'applied', frame: { text: 'SEEDXAB', cursor: 7 } })
  expect(serialize(editor.state.doc)).toBe('SEEDXAB')
  bridge.dispose(); editor.commands.insertContent('c')
  expect(send).toHaveBeenCalledTimes(4)
})

it('ignores retired replies and preserves the draft on unrepresentable native changes', () => {
  editor.commands.setContent('safe')
  const send = vi.fn(), problem = vi.fn()
  const bridge = bindClaudePromptEditor(editor, send, problem)
  bridge.receive({ revision: 1, status: 'applied', frame: { text: '**safe**', cursor: 1 } })
  expect(serialize(editor.state.doc)).toBe('safe')
  expect(problem).toHaveBeenLastCalledWith(expect.stringContaining('cannot be represented'))
  bridge.dispose()
  bridge.receive({ revision: 1, status: 'applied', frame: { text: 'BAD', cursor: 3 } })
  expect(serialize(editor.state.doc)).toBe('safe')
})


it('marks history adoption as app-owned even inside a keyboard event task', () => {
  const send = vi.fn(), bridge = bindClaudePromptEditor(editor, send, vi.fn())
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
  editor.chain().setMeta('claude-prompt-by', 'app').setContent('history').run()
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ by: 'app', text: 'history' }))
  bridge.dispose()
})


it('can detach and settle after the editor has already been destroyed', async () => {
  const bridge = bindClaudePromptEditor(editor, vi.fn(), vi.fn())
  const waiting = bridge.settle()
  editor.destroy()
  await expect(waiting).resolves.toBe(false)
  expect(() => bridge.dispose()).not.toThrow()
})


it('forwards typed key metadata only for person-originated edits', () => {
  const send = vi.fn(), bridge = bindClaudePromptEditor(editor, send, vi.fn())
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', shiftKey: true, bubbles: true }))
  editor.commands.insertContent('X')
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ by: 'person', key: { key: 'x', shift: true } }))
  editor.chain().setMeta('claude-prompt-by', 'app').setContent('history').run()
  expect(send.mock.lastCall![0]).not.toHaveProperty('key')
  bridge.dispose()
})


it('continues the mounted view revision after the editor is rebound', () => {
  const send = vi.fn(), bridge = bindClaudePromptEditor(editor, send, vi.fn(), 12)
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 13 }))
  bridge.dispose()
})


it('renders native styling without changing serialized text, and clears it on new edits or detach', () => {
  editor.commands.setContent('hello world')
  const send = vi.fn(), bridge = bindClaudePromptEditor(editor, send, vi.fn())
  bridge.receive({ revision: 1, status: 'applied', frame: { text: 'hello world', cursor: 11, decorations: [{ start: 0, end: 5, bold: true, italic: true, underline: true, color: 'success' }] } })
  const span = editor.view.dom.querySelector('.claude-prompt-decoration')! as HTMLElement
  expect(span.textContent).toBe('hello')
  expect(span.style.fontWeight).toBe('600')
  expect(span.style.fontStyle).toBe('italic')
  expect(serialize(editor.state.doc)).toBe('hello world')
  editor.commands.insertContent('!')
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')).toBeNull()
  const request = send.mock.lastCall![0]
  bridge.receive({ revision: request.revision, status: 'applied', frame: { text: request.text, cursor: request.cursor, decorations: [{ start: 0, end: 5, bold: true }] } })
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')).not.toBeNull()
  bridge.dispose()
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')).toBeNull()
})

it('projects decoration ranges around Markdown syntax onto visible text', () => {
  editor.commands.setContent('**hello**')
  const bridge = bindClaudePromptEditor(editor, vi.fn(), vi.fn())
  bridge.receive({ revision: 1, status: 'applied', frame: { text: '**hello**', cursor: 7, decorations: [{ start: 0, end: 9, italic: true }] } })
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')?.textContent).toBe('hello')
  expect(serialize(editor.state.doc)).toBe('**hello**')
  bridge.dispose()
})

it('draws virtual text as inert text outside the draft and refuses arbitrary color CSS', () => {
  editor.commands.setContent('seed')
  const bridge = bindClaudePromptEditor(editor, vi.fn(), vi.fn())
  bridge.receive({ revision: 1, status: 'applied', frame: { text: 'seed', cursor: 4, decorations: [
    { start: 0, end: 0, virtualText: '<script>hint</script>' },
    { start: 0, end: 4, bold: true, color: 'red;position:fixed', backgroundColor: 'url(https://example.com/)' },
  ] } })
  const hint = editor.view.dom.querySelector('.claude-prompt-virtual')! as HTMLElement
  expect(hint.textContent).toBe('<script>hint</script>')
  expect(hint.contentEditable).toBe('false')
  expect(editor.view.dom.querySelector('script')).toBeNull()
  expect(serialize(editor.state.doc)).toBe('seed')
  expect(editor.state.doc.textContent).toBe('seed')
  const span = editor.view.dom.querySelector('.claude-prompt-decoration')! as HTMLElement
  expect(span.style.color).toBe('')
  expect(span.style.backgroundColor).toBe('')
  bridge.dispose()
})


it('settles a failed dispatch instead of leaving Send pending', async () => {
  const problem = vi.fn()
  const bridge = bindClaudePromptEditor(editor, () => { throw new Error('Dispatch closed') }, problem)
  await expect(bridge.settle()).resolves.toBe(false)
  expect(problem).toHaveBeenLastCalledWith('Dispatch closed')
  bridge.dispose()
})


it('reads the live UTF-16 draft and fills insert/append/replace without focusing the editor', () => {
  editor.commands.setContent('Draft🙂'); editor.commands.setTextSelection(6)
  const send = vi.fn(), bridge = bindClaudePromptEditor(editor, send, vi.fn())
  const elsewhere = document.createElement('button'); document.body.append(elsewhere); elsewhere.focus()
  expect(bridge.readDraft()).toEqual({ text: 'Draft🙂', cursor: 5 })
  expect(bridge.fillDraft({ mode: 'insert', text: ' native' }, bridge.revision)).toBe(true)
  expect(bridge.readDraft()).toEqual({ text: 'Draft native🙂', cursor: 12 })
  expect(document.activeElement).toBe(elsewhere)
  expect(send.mock.calls.at(-1)?.[0].by).toBe('app')
  expect(bridge.fillDraft({ mode: 'append', text: '\n\nNext paragraph' }, bridge.revision)).toBe(true)
  expect(serialize(editor.state.doc)).toBe('Draft native🙂\n\nNext paragraph')
  expect(bridge.fillDraft({ mode: 'replace', text: '**New**\n\n- item' }, bridge.revision)).toBe(true)
  expect(serialize(editor.state.doc)).toBe('**New**\n\n- item')
  expect(editor.state.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold')
  elsewhere.remove(); bridge.dispose()
})

it('refuses expired draft revisions, IME and disposed fills while preserving newer text', () => {
  editor.commands.setContent('original')
  const bridge = bindClaudePromptEditor(editor, vi.fn(), vi.fn()), old = bridge.revision
  editor.commands.insertContent('newer')
  const draft = serialize(editor.state.doc)
  expect(bridge.fillDraft({ mode: 'replace', text: 'stale' }, old)).toBe(false)
  const composing = vi.spyOn(editor.view, 'composing', 'get').mockReturnValue(true)
  expect(bridge.readDraft()).toBeUndefined()
  expect(bridge.fillDraft({ mode: 'replace', text: 'IME' }, bridge.revision)).toBe(false)
  composing.mockRestore(); bridge.dispose()
  expect(bridge.readDraft()).toBeUndefined()
  expect(bridge.fillDraft({ mode: 'replace', text: 'closed' }, bridge.revision)).toBe(false)
  expect(serialize(editor.state.doc)).toBe(draft)
})

it('paints inserted fill decorations at their new offset without adding decorated text to the draft', () => {
  editor.commands.setContent('prefix'); editor.commands.setTextSelection(editor.state.doc.content.size - 1)
  const bridge = bindClaudePromptEditor(editor, vi.fn(), vi.fn())
  expect(bridge.fillDraft({ mode: 'append', text: ' native', decorations: [{ start: 1, end: 7, bold: true }] }, bridge.revision)).toBe(true)
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')?.textContent).toBe('native')
  expect(serialize(editor.state.doc)).toBe('prefix native')
  bridge.dispose()
})


it('leaves the current draft unchanged if its Markdown parser refuses a structural fill', () => {
  editor.commands.setContent('Keep this draft')
  const bridge = bindClaudePromptEditor(editor, vi.fn(), vi.fn())
  const parser = (editor.storage as unknown as { markdown: { parser: { parse(text: string): string } } }).markdown.parser
  const parsing = vi.spyOn(parser, 'parse').mockImplementationOnce(() => { throw Error('custom parser refused') })
  try {
    expect(bridge.fillDraft({ mode: 'replace', text: '**native**' }, bridge.revision)).toBe(false)
    expect(serialize(editor.state.doc)).toBe('Keep this draft')
  } finally { parsing.mockRestore(); bridge.dispose() }
})


it('keeps fill paint through its app acknowledgement and replaces it on the next actual edit answer', () => {
  editor.commands.setContent('draft')
  const bridge = bindClaudePromptEditor(editor, vi.fn(), vi.fn())
  expect(bridge.fillDraft({ mode: 'append', text: ' native', decorations: [{ start: 1, end: 7, italic: true }] }, bridge.revision)).toBe(true)
  const frame = bridge.readDraft()!
  bridge.receive({ revision: bridge.revision, status: 'applied', frame })
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')?.textContent).toBe('native')
  expect(editor.view.dom.querySelector<HTMLElement>('.claude-prompt-decoration')?.style.fontStyle).toBe('italic')
  expect(serialize(editor.state.doc)).toBe('draft native')
  editor.commands.insertContent(' next')
  bridge.receive({ revision: bridge.revision, status: 'applied', frame: bridge.readDraft()! })
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')).toBeNull()
  expect(serialize(editor.state.doc)).toBe('draft native next')
  bridge.dispose()
})

it('allows explicit native paint to override a fill acknowledgement and ignores old acknowledgements', () => {
  editor.commands.setContent('draft')
  const bridge = bindClaudePromptEditor(editor, vi.fn(), vi.fn())
  bridge.fillDraft({ mode: 'replace', text: 'first', decorations: [{ start: 0, end: 5, italic: true }] }, bridge.revision)
  const old = { revision: bridge.revision, status: 'applied' as const, frame: bridge.readDraft()! }
  bridge.fillDraft({ mode: 'replace', text: 'second', decorations: [{ start: 0, end: 6, bold: true }] }, bridge.revision)
  bridge.receive(old)
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')?.textContent).toBe('second')
  bridge.receive({ revision: bridge.revision, status: 'applied', frame: { ...bridge.readDraft()!, decorations: [] } })
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')).toBeNull()
  bridge.dispose()
})


it('keeps ghost text out of the draft and accepts Tab as a person edit with its original key', () => {
  editor.commands.clearContent()
  const send = vi.fn(), bridge = bindClaudePromptEditor(editor, send, vi.fn())
  const revision = bridge.revision
  expect(bridge.showSuggestion('Native ghost', revision)).toBe(true)
  expect(bridge.readDraft()).toEqual({ text: '', cursor: 0 })
  expect(serialize(editor.state.doc)).toBe('')
  expect(editor.view.dom.querySelector('.claude-prompt-suggestion')?.textContent).toBe('Native ghost')
  expect(editor.view.dom.querySelector('.claude-prompt-suggestion')?.getAttribute('aria-hidden')).toBe('true')
  expect(send).toHaveBeenCalledTimes(1)
  bridge.receive({ revision, status: 'applied', frame: { text: '', cursor: 0 } })
  expect(editor.view.dom.querySelector('.claude-prompt-suggestion')).not.toBeNull()
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  editor.view.dom.dispatchEvent(tab)
  expect(tab.defaultPrevented).toBe(true)
  expect(serialize(editor.state.doc)).toBe('Native ghost')
  expect(editor.view.dom.querySelector('.claude-prompt-suggestion')).toBeNull()
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ by: 'person', key: { key: 'tab' }, text: 'Native ghost' })
  bridge.dispose()
})

it('accepts Right Arrow but leaves modified keys, IME and competing UI to their owners', () => {
  editor.commands.clearContent()
  let eligible = true
  const bridge = bindClaudePromptEditor(editor, vi.fn(), vi.fn(), 0, undefined, { canSuggest: () => eligible })
  expect(bridge.showSuggestion('**Rich** ghost', bridge.revision)).toBe(true)
  const key = (init: KeyboardEventInit) => { const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...init }); editor.view.dom.dispatchEvent(event); return event }
  for (const modifier of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) expect(key(modifier).defaultPrevented).toBe(false)
  eligible = false; expect(key({}).defaultPrevented).toBe(false)
  expect(serialize(editor.state.doc)).toBe('')
  eligible = true; expect(key({ key: 'ArrowRight' }).defaultPrevented).toBe(true)
  expect(serialize(editor.state.doc)).toBe('**Rich** ghost')
  expect(editor.state.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold')
  bridge.dispose()
})

it('rejects stale/nonempty suggestions and clears ghost text on typing, composition, blur and dispose', () => {
  editor.commands.clearContent()
  const bridge = bindClaudePromptEditor(editor, vi.fn(), vi.fn())
  expect(bridge.showSuggestion('stale', bridge.revision - 1)).toBe(false)
  expect(bridge.showSuggestion('  ', bridge.revision)).toBe(false)
  expect(bridge.showSuggestion('ghost', bridge.revision)).toBe(true)
  editor.commands.insertContent('typed')
  expect(editor.view.dom.querySelector('.claude-prompt-suggestion')).toBeNull()
  expect(serialize(editor.state.doc)).toBe('typed')
  expect(bridge.showSuggestion('overwrite', bridge.revision)).toBe(false)
  editor.commands.clearContent(); bridge.showSuggestion('compose', bridge.revision)
  editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart'))
  expect(editor.view.dom.querySelector('.claude-prompt-suggestion')).toBeNull()
  editor.view.dom.dispatchEvent(new CompositionEvent('compositionend'))
  expect(bridge.showSuggestion('blur', bridge.revision)).toBe(true); window.dispatchEvent(new Event('blur'))
  expect(editor.view.dom.querySelector('.claude-prompt-suggestion')).toBeNull()
  bridge.showSuggestion('dispose', bridge.revision); bridge.dispose()
  expect(editor.view.dom.querySelector('.claude-prompt-suggestion')).toBeNull()
  expect(editor.view.dom.hasAttribute('data-native-suggestion')).toBe(false)
  expect(bridge.showSuggestion('closed', bridge.revision)).toBe(false)
})


it('maps the app serializer empty-paragraph entity to a native empty box and permits its first suggestion', () => {
  editor.commands.clearContent()
  const serializer = (editor.storage as unknown as { markdown: { serializer: { serialize(doc: import('@tiptap/pm/model').Node): string } } }).markdown.serializer
  const original = serializer.serialize.bind(serializer)
  const spelling = vi.spyOn(serializer, 'serialize').mockImplementation(doc => doc.childCount === 1 && doc.firstChild?.type.name === 'paragraph' && !doc.firstChild.content.size ? '&nbsp;' : original(doc))
  const send = vi.fn(), bridge = bindClaudePromptEditor(editor, send, vi.fn())
  try {
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ text: '', cursor: 0 }))
    expect(bridge.readDraft()).toEqual({ text: '', cursor: 0 })
    expect(bridge.showSuggestion('First native suggestion', bridge.revision)).toBe(true)
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(bridge.readDraft()?.text).toBe('First native suggestion')
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '&nbsp;' }] }] })
    expect(bridge.readDraft()?.text).toBe(original(editor.state.doc))
    expect(bridge.readDraft()?.text).not.toBe('')
  } finally { bridge.dispose(); spelling.mockRestore() }
})

it('preserves select-all replacement when native acknowledges unchanged text and cursor', () => {
  editor.commands.setContent('/cc-reset')
  const send = vi.fn(), bridge = bindClaudePromptEditor(editor, send, vi.fn())
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })
  const selected = editor.state.selection, request = send.mock.lastCall![0]
  expect(selected.empty).toBe(false)
  bridge.receive({ revision: request.revision, status: 'applied', frame: { text: request.text, cursor: request.cursor } })
  expect(editor.state.selection.eq(selected)).toBe(true)
  editor.commands.insertContent('/model haiku')
  expect(serialize(editor.state.doc)).toBe('/model haiku')
  bridge.dispose()
})
it('honors an actual native cursor change while a range was selected', () => {
  editor.commands.setContent('draft')
  const send = vi.fn(), bridge = bindClaudePromptEditor(editor, send, vi.fn())
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })
  const request = send.mock.lastCall![0]
  bridge.receive({ revision: request.revision, status: 'applied', frame: { text: request.text, cursor: 0 } })
  expect(editor.state.selection.empty).toBe(true)
  expect(editor.state.selection.head).toBe(findClaudePromptPosition(editor.state.doc, 0, serialize))
  bridge.dispose()
})


it.each(['**safe**', '# Heading\n\nBody', '* first\n* second', 'before\n\n```ts\nconst x = 1\n```'])('applies a native structural Markdown rewrite: %s', text => {
  editor.commands.setContent('seed')
  const send = vi.fn(), problem = vi.fn(), bridge = bindClaudePromptEditor(editor, send, problem)
  bridge.receive({ revision: send.mock.lastCall![0].revision, status: 'applied', frame: { text, cursor: text.includes('```') ? text.indexOf('const x = 1') + 11 : text.length } })
  const expected = text.startsWith('* first') ? '- first\n- second' : text
  expect(serialize(editor.state.doc)).toBe(expected)
  expect(problem).toHaveBeenLastCalledWith(undefined)
  if (expected !== text) expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ by: 'app', text: expected }))
  expect(editor.state.doc.toJSON()).not.toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  bridge.dispose()
})
it('refuses a structural reply during composition without replacing the composing draft', async () => {
  editor.commands.setContent('composing')
  const bridge = bindClaudePromptEditor(editor, vi.fn(), vi.fn())
  Object.defineProperty(editor.view, 'composing', { configurable: true, value: true })
  bridge.receive({ revision: bridge.revision, status: 'applied', frame: { text: '**changed**', cursor: 5 } })
  expect(serialize(editor.state.doc)).toBe('composing')
  expect(await bridge.settle()).toBe(false)
  bridge.dispose()
})
it('retains unchanged reference attributes when native Markdown adds surrounding block structure', () => {
  editor.destroy()
  const reference = Node.create({ name: 'reference', group: 'inline', inline: true, atom: true,
    addAttributes: () => ({ id: { default: 'ref-id' }, label: { default: 'Note' }, retained: { default: 'parsed' } }),
    parseHTML: () => [{ tag: 'a[href="ref:ref-id"]' }], renderHTML: () => ['a', { href: 'ref:ref-id' }, 'Note'],
    addStorage: () => ({ markdown: { serialize(state: { write(text: string): void }) { state.write('[Note](ref:ref-id)') } } }),
  })
  editor = new Editor({ extensions: [StarterKit, Markdown, reference], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello ' }, { type: 'reference', attrs: { retained: 'original' } }, { type: 'text', text: ' after' }] }] } })
  const original = editor.state.doc.firstChild!.child(1), send = vi.fn(), bridge = bindClaudePromptEditor(editor, send, vi.fn())
  const text = '# Heading\n\nhello [Note](ref:ref-id) after'
  bridge.receive({ revision: bridge.revision, status: 'applied', frame: { text, cursor: text.length } })
  expect(serialize(editor.state.doc)).toBe(text)
  let retained: unknown
  editor.state.doc.descendants(node => { if (node.type.name === 'reference') retained = node.attrs })
  expect(retained).toEqual(original.attrs)
  bridge.dispose()
})

it('maps native content decorations through structural normalization and retains them through canonical adoption', () => {
  editor.commands.setContent('safe')
  const send = vi.fn(), problem = vi.fn(), bridge = bindClaudePromptEditor(editor, send, problem)
  const text = '__Title__\n\n*   first\n*   second', canonical = '**Title**\n\n- first\n- second'
  const first = text.indexOf('first'), second = text.indexOf('second')
  const parsed = rewriteClaudePromptDocument(captureClaudePromptDocument(editor.state.doc, editor.state.selection.head, serialize)!, { text, cursor: text.length }, serialize, value => { const template = document.createElement('template'); template.innerHTML = (editor.storage as unknown as { markdown: { parser: { parse(value: string): string } } }).markdown.parser.parse(value); return PromptDOMParser.fromSchema(editor.schema).parse(template.content) }, [first, first + 5, second, second + 6])!
  expect(parsed.sourcePositions).toBeDefined()
  expect(findClaudePromptPosition(parsed.doc, canonical.indexOf('first'), serialize)).toBeTypeOf('number')
  expect(parsed.sourcePositions?.get(first)).toBe(findClaudePromptPosition(parsed.doc, canonical.indexOf('first'), serialize))
  expect(parsed.sourcePositions?.get(second)).toBe(findClaudePromptPosition(parsed.doc, canonical.indexOf('second'), serialize))
  expect(drawClaudePromptDecorations(parsed.doc, [{ start: first, end: first + 5, color: 'red' }, { start: second, end: second + 6, underline: true }], serialize, parsed.sourcePositions).find()).toHaveLength(2)
  bridge.receive({ revision: bridge.revision, status: 'applied', frame: { text, cursor: text.length, decorations: [{ start: first, end: first + 5, color: 'red' }, { start: second, end: second + 6, underline: true }] } })
  expect(serialize(editor.state.doc)).toBe(canonical)
  expect([...editor.view.dom.querySelectorAll('.claude-prompt-decoration')].map(node => node.textContent)).toEqual(['first', 'second'])
  const request = send.mock.lastCall![0]
  expect(request).toEqual(expect.objectContaining({ by: 'app', text: canonical, cursor: canonical.length }))
  bridge.receive({ revision: request.revision, status: 'applied', frame: { text: request.text, cursor: request.cursor } })
  expect([...editor.view.dom.querySelectorAll('.claude-prompt-decoration')].map(node => node.textContent)).toEqual(['first', 'second'])
  expect(problem).toHaveBeenLastCalledWith(undefined)
  editor.commands.insertContent(' person')
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')).toBeNull()
  bridge.dispose()
})

it('normalizes decorated native fills and preserves their paint through app acknowledgement', () => {
  editor.commands.setContent('safe')
  const send = vi.fn(), bridge = bindClaudePromptEditor(editor, send, vi.fn())
  const text = '*   first\n*   second', start = text.indexOf('second')
  expect(bridge.fillDraft({ mode: 'replace', text, decorations: [{ start, end: start + 6, bold: true }] }, bridge.revision)).toBe(true)
  expect(serialize(editor.state.doc)).toBe('- first\n- second')
  const request = send.mock.lastCall![0]
  bridge.receive({ revision: request.revision, status: 'applied', frame: { text: request.text, cursor: request.cursor } })
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')?.textContent).toBe('second')
  expect(serialize(editor.state.doc)).toBe('- first\n- second')
  bridge.dispose()
})

it.each([
  {text:'*   first\n*   second',start:0,end:7,canonical:'- first\n- second',paint:'fir'},
  {text:'__Title__\n\n*   first',start:1,end:8,canonical:'**Title**\n\n- first',paint:'Title'},
  {text:'__😀 Title__\n\n*   first',start:1,end:11,canonical:'**😀 Title**\n\n- first',paint:'😀 Title'},
  {text:'*   same\n*   same',start:10,end:17,canonical:'- same\n- same',paint:'same'},
])('maps source syntax decoration boundaries without rejecting a valid native rewrite: $text', async ({text,start,end,canonical,paint}) => {
  editor.commands.setContent('safe')
  const send=vi.fn(),problem=vi.fn(),bridge = bindClaudePromptEditor(editor, send, problem)
  bridge.receive({ revision: bridge.revision, status: 'applied', frame: { text, cursor: text.length, decorations: [{ start, end, color: 'red' }] } })
  expect(serialize(editor.state.doc)).toBe(canonical)
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')?.textContent).toBe(paint)
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({by:'app',text:canonical}))
  const ack=send.mock.lastCall![0];bridge.receive({revision:ack.revision,status:'applied',frame:{text:ack.text,cursor:ack.cursor}})
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')?.textContent).toBe(paint)
  expect(problem).toHaveBeenLastCalledWith(undefined)
  bridge.dispose()
})

it('keeps inward decoration projection around canonical structural Markdown delimiters', () => {
  editor.commands.setContent('safe')
  const bridge = bindClaudePromptEditor(editor, vi.fn(), vi.fn()), text = '**styled**'
  bridge.receive({ revision: bridge.revision, status: 'applied', frame: { text, cursor: text.length, decorations: [{ start: 0, end: text.length, underline: true }] } })
  expect(serialize(editor.state.doc)).toBe(text)
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')?.textContent).toBe('styled')
  bridge.dispose()
})

it('keeps native theme roles live in existing paint without changing the draft, selection or submitting another edit', () => {
 editor.commands.setContent('keep this draft');editor.commands.setTextSelection({from:2,to:6});
 const send=vi.fn(),bridge=bindClaudePromptEditor(editor,send,vi.fn());
 const doc=editor.state.doc,selection=editor.state.selection;
 const runs=[{start:0,end:4,color:'#abcdef',_apackThemeColor:'warning'}];
 editor.view.dispatch(editor.state.tr.setMeta('theme-fixture',true));
 const drawn=drawClaudePromptDecorations(editor.state.doc,runs,serialize);
 expect((drawn.find()[0] as any).type.attrs.style).toContain('var(--claude-native-prompt-warning,');
 const count=send.mock.calls.length;
 for (const [key,value] of Object.entries(claudePromptThemeStyle({text:'#123456',warning:'#abcdef'}))) editor.view.dom.style.setProperty(key,String(value));
 expect(editor.view.dom.style.getPropertyValue('--claude-native-prompt-warning')).toBe(claudeUiColor('#abcdef'));
 for (const [key,value] of Object.entries(claudePromptThemeStyle({text:'#123456',warning:'#010203'}))) editor.view.dom.style.setProperty(key,String(value));
 expect(editor.view.dom.style.getPropertyValue('--claude-native-prompt-warning')).toBe(claudeUiColor('#010203'));
 expect(editor.state.doc).toBe(doc);expect(editor.state.selection.eq(selection)).toBe(true);expect(send).toHaveBeenCalledTimes(count);
 bridge.dispose();
})

it('attributes browser-delayed keyboard selection to the person and preserves its native key', async () => {
  editor.commands.setContent('hello world')
  document.body.append(editor.view.dom)
  const scroll = editor.view.props.handleScrollToSelection
  editor.view.setProps({ handleScrollToSelection: () => true })
  const send = vi.fn(), bridge = bindClaudePromptEditor(editor, send, vi.fn())
  try {
    editor.view.focus()
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
    const text = editor.view.dom.querySelector('p')!.firstChild!
    document.getSelection()!.setBaseAndExtent(text, 0, text, 2)
    document.dispatchEvent(new Event('selectionchange'))
    expect(send.mock.lastCall![0]).toMatchObject({ by: 'person', cursor: 2, key: { key: 'home' } })
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.to).toBe(3)
    const selected = editor.state.selection, request = send.mock.lastCall![0]
    bridge.receive({ revision: request.revision, status: 'applied', frame: { text: request.text, cursor: request.cursor } })
    expect(editor.state.selection.eq(selected)).toBe(true)
    expect(bridge.fillDraft({ mode: 'replace', text: 'native fill' }, bridge.revision)).toBe(true)
    expect(send.mock.lastCall![0].by).toBe('app')
    expect(send.mock.lastCall![0].key).toBeUndefined()
  } finally { bridge.dispose(); editor.view.setProps({ handleScrollToSelection: scroll }) }
})


it('keeps a delayed selection and its key scoped to the currently focused editor', async () => {
  const other = new Editor({ extensions: [StarterKit, Markdown] })
  editor.commands.setContent('parent draft'); other.commands.setContent('worker draft')
  document.body.append(editor.view.dom, other.view.dom)
  const firstScroll = editor.view.props.handleScrollToSelection
  editor.view.setProps({ handleScrollToSelection: () => true })
  other.view.setProps({ handleScrollToSelection: () => true })
  const firstSend = vi.fn(), otherSend = vi.fn()
  const firstBridge = bindClaudePromptEditor(editor, firstSend, vi.fn()), otherBridge = bindClaudePromptEditor(other, otherSend, vi.fn())
  try {
    editor.view.focus()
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
    const count = firstSend.mock.calls.length
    other.view.focus()
    const text = other.view.dom.querySelector('p')!.firstChild!
    document.getSelection()!.setBaseAndExtent(text, 0, text, 3)
    document.dispatchEvent(new Event('selectionchange'))
    expect(otherSend.mock.lastCall![0]).toMatchObject({ by: 'person', text: 'worker draft', cursor: 3 })
    expect(otherSend.mock.lastCall![0].key).toBeUndefined()
    expect(firstSend).toHaveBeenCalledTimes(count)
    expect(firstBridge.readDraft()?.text).toBe('parent draft')
    expect(otherBridge.readDraft()?.text).toBe('worker draft')
  } finally { firstBridge.dispose(); otherBridge.dispose(); editor.view.setProps({ handleScrollToSelection: firstScroll }); other.destroy() }
})


it('maps decoration boundaries inside noncanonical code fences without changing code or caret', () => {
  editor.commands.setContent('safe')
  const send=vi.fn(),problem=vi.fn(),bridge=bindClaudePromptEditor(editor,send,problem)
  const text='~~~ts\nconst ready = true\n~~~\n\n*   Context',canonical='```ts\nconst ready = true\n```\n\n- Context'
  const cursor=text.indexOf('ready')+5,end=text.indexOf('~~~',3)+2
  bridge.receive({revision:bridge.revision,status:'applied',frame:{text,cursor,decorations:[{start:1,end,underline:true,color:'red'}]}})
  expect(problem).toHaveBeenLastCalledWith(undefined)
  expect(serialize(editor.state.doc)).toBe(canonical)
  expect(editor.view.dom.querySelector('.claude-prompt-decoration')?.textContent).toBe('const ready = true')
  expect(captureClaudePromptDocument(editor.state.doc,editor.state.selection.head,serialize)?.cursor).toBe(canonical.indexOf('ready')+5)
  bridge.dispose()
})

it('keeps a newer browser caret when a native acknowledgement arrives before selectionchange', () => {
  editor.commands.setContent('worker draft')
  document.body.append(editor.view.dom)
  editor.view.setProps({ handleScrollToSelection: () => true })
  editor.view.focus()
  const send = vi.fn(), bridge = bindClaudePromptEditor(editor, send, vi.fn())
  try {
    const request = send.mock.lastCall![0]
    expect(request.cursor).toBe('worker draft'.length)
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    const text = editor.view.dom.querySelector('p')!.firstChild!
    document.getSelection()!.setBaseAndExtent(text, 3, text, 3)
    // The browser has moved; ProseMirror has not received its delayed selectionchange yet.
    expect(editor.state.selection.head).toBe('worker draft'.length + 1)
    bridge.receive({ revision: request.revision, status: 'applied', frame: { text: request.text, cursor: request.cursor } })
    expect(bridge.readDraft()).toEqual({ text: 'worker draft', cursor: 3 })
    expect(document.getSelection()!.focusOffset).toBe(3)
  } finally { bridge.dispose() }
})


it('does not adopt a pending browser selection because an unrelated native reply arrived', () => {
  editor.commands.setContent('worker draft')
  document.body.append(editor.view.dom)
  editor.view.setProps({ handleScrollToSelection: () => true })
  editor.view.focus()
  const send = vi.fn(), bridge = bindClaudePromptEditor(editor, send, vi.fn())
  try {
    const request = send.mock.lastCall![0], text = editor.view.dom.querySelector('p')!.firstChild!
    document.getSelection()!.setBaseAndExtent(text, 3, text, 3)
    bridge.receive({ revision: request.revision - 1, status: 'applied', frame: { text: request.text, cursor: request.cursor } })
    expect(editor.state.selection.head).toBe('worker draft'.length + 1)
    expect(send).toHaveBeenCalledOnce()
    expect(document.getSelection()!.focusOffset).toBe(3)
  } finally { bridge.dispose() }
})


it.each(['b', 'i'])('formats the visible browser selection before deferred selectionchange (%s)', key => {
  editor.commands.setContent('Review changes.')
  document.body.append(editor.view.dom)
  editor.view.setProps({ handleScrollToSelection: () => true })
  editor.view.focus()
  const bridge = bindClaudePromptEditor(editor, vi.fn(), vi.fn())
  try {
    const text = editor.view.dom.querySelector('p')!.firstChild!
    document.getSelection()!.setBaseAndExtent(text, 0, text, 2)
    expect(editor.state.selection.empty).toBe(true)
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, code: 'Key'+key.toUpperCase(), ctrlKey: true, bubbles: true, cancelable: true }))
    expect(editor.state.doc.firstChild!.firstChild!.text).toBe('Re')
    expect(editor.state.doc.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual([key === 'b' ? 'bold' : 'italic'])
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.to).toBe(3)
  } finally { bridge.dispose() }
})

it('applies explicit native font resets over rich formatting without altering the draft or selection', () => {
  editor.commands.setContent('***Review notes***')
  editor.commands.setTextSelection(3)
  const doc=editor.state.doc,selection=editor.state.selection,text=serialize(doc)
  const send=vi.fn(),bridge=bindClaudePromptEditor(editor,send,vi.fn()),before=send.mock.calls.length
  const cursor=captureClaudePromptDocument(doc,selection.head,serialize)!.cursor
  bridge.receive({revision:bridge.revision,status:'applied',frame:{text,cursor,decorations:[{start:3,end:15,bold:false,italic:false,dimColor:false}]}})
  const paint=editor.view.dom.querySelector<HTMLElement>('.claude-prompt-decoration')
  expect(paint?.textContent).toBe('Review notes')
  expect(paint?.style.fontWeight).toBe('normal')
  expect(paint?.style.fontStyle).toBe('normal')
  expect(paint?.style.opacity).toBe('1')
  expect(editor.state.doc.eq(doc)).toBe(true)
  expect(editor.state.selection.eq(selection)).toBe(true)
  expect(editor.state.doc.firstChild?.firstChild?.marks.map(mark=>mark.type.name)).toEqual(expect.arrayContaining(['bold','italic']))
  expect(send).toHaveBeenCalledTimes(before)
  bridge.dispose()
})

it('retains rich formatting when native decoration font properties are absent', () => {
  editor.commands.setContent('***Review notes***')
  const text=serialize(editor.state.doc),drawn=drawClaudePromptDecorations(editor.state.doc,[{start:3,end:15,color:'red'}],serialize)
  const attrs=(drawn.find()[0] as any).type.attrs
  expect(attrs.style).not.toMatch(/font-weight|font-style|opacity/)
  expect(serialize(editor.state.doc)).toBe(text)
  expect(editor.state.doc.firstChild?.firstChild?.marks.map(mark=>mark.type.name)).toEqual(expect.arrayContaining(['bold','italic']))
})

it('resets native lines inside a rich strike mark without losing adjacent strike or draft data', () => {
  editor.commands.setContent('~~Review notes and rollout~~')
  editor.commands.setTextSelection(3)
  const doc=editor.state.doc,selection=editor.state.selection,text=serialize(doc)
  const send=vi.fn(),bridge=bindClaudePromptEditor(editor,send,vi.fn()),before=send.mock.calls.length
  const cursor=captureClaudePromptDocument(doc,selection.head,serialize)!.cursor
  bridge.receive({revision:bridge.revision,status:'applied',frame:{text,cursor,decorations:[{start:2,end:14,underline:false,strikethrough:false}]}})
  const paint=editor.view.dom.querySelector<HTMLElement>('.claude-prompt-decoration')
  expect(paint?.textContent).toBe('Review notes')
  expect(paint?.style.textDecorationLine).toBe('none')
  const inherited=editor.view.dom.querySelector<HTMLElement>('.claude-prompt-line-inherit')
  expect(inherited?.textContent).toBe(' and rollout')
  expect(inherited?.style.textDecorationLine).toBe('line-through')
  expect(editor.state.doc.eq(doc)).toBe(true);expect(editor.state.selection.eq(selection)).toBe(true)
  expect(editor.view.dom.querySelector('s')?.textContent).toBe('Review notes and rollout')
  expect(send).toHaveBeenCalledTimes(before)
  bridge.dispose()
})

it.each([
  [true,false,'underline'],[false,true,'line-through'],[true,true,'underline line-through'],[false,false,'none'],
] as const)('keeps native underline %s and strike %s independent over rich strike', (underline,strikethrough,line) => {
  editor.commands.setContent('~~Review notes and rollout~~')
  const drawn=drawClaudePromptDecorations(editor.state.doc,[{start:2,end:14,underline,strikethrough}],serialize)
  const native=drawn.find().find(item=>(item as any).type.attrs.class.includes('claude-prompt-decoration'))!
  const inherited=drawn.find().find(item=>(item as any).type.attrs.class.includes('claude-prompt-line-inherit'))!
  expect((native as any).type.attrs.style).toContain('text-decoration-line:'+line)
  expect((inherited as any).type.attrs.style).toBe('text-decoration-line:line-through')
})

it('recomputes inherited line paint when native schema maintenance changes marks', () => {
  editor.commands.setContent('~~Review notes and rollout~~')
  const {key,plugin}=createClaudePromptDecorations();editor.registerPlugin(plugin)
  const original=editor.state.tr.setMeta(key,drawClaudePromptDecorations(editor.state.doc,[{start:2,end:14,strikethrough:false}],serialize))
  editor.view.dispatch(original)
  expect(editor.view.dom.querySelector('.claude-prompt-line-inherit')?.textContent).toBe(' and rollout')
  const normalization=editor.state.tr.removeMark(1,editor.state.doc.content.size-1,editor.schema.marks.strike).setMeta('appendedTransaction',original)
  editor.view.dispatch(normalization)
  expect(editor.view.dom.querySelector('.claude-prompt-line-inherit')).toBeNull()
  expect(editor.view.dom.querySelector<HTMLElement>('.claude-prompt-decoration')?.style.textDecorationLine).toBe('none')
  expect(editor.view.dom.textContent).toBe('Review notes and rollout')
  editor.unregisterPlugin(key)
})

it('retires temporary line spans on a person edit while keeping the rich mark', () => {
  editor.commands.setContent('~~Review notes and rollout~~')
  const {key,plugin}=createClaudePromptDecorations();editor.registerPlugin(plugin)
  editor.view.dispatch(editor.state.tr.setMeta(key,drawClaudePromptDecorations(editor.state.doc,[{start:2,end:14,strikethrough:false}],serialize)))
  expect(editor.view.dom.querySelector('.claude-prompt-line-paint')).not.toBeNull()
  editor.commands.setTextSelection(3)
  expect(editor.view.dom.querySelector('.claude-prompt-line-paint')).toBeNull()
  expect(editor.view.dom.querySelector('s')?.textContent).toBe('Review notes and rollout')
  expect(serialize(editor.state.doc)).toBe('~~Review notes and rollout~~')
  editor.unregisterPlugin(key)
})

it('resets native lines over the chat-admitted underline mark with HTML input disabled', () => {
  editor.destroy()
  editor=new Editor({extensions:[StarterKit.configure({strike:false}),Markdown.configure({html:false})]})
  const underline=editor.schema.marks.underline
  expect(underline).toBeDefined()
  editor.commands.setContent({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Review notes and rollout',marks:[{type:'underline'}]}]}]})
  editor.commands.setTextSelection(3)
  const doc=editor.state.doc,selection=editor.state.selection,text=serialize(doc),start=text.indexOf('Review notes')
  const bridge=bindClaudePromptEditor(editor,vi.fn(),vi.fn())
  bridge.receive({revision:bridge.revision,status:'applied',frame:{text,cursor:captureClaudePromptDocument(doc,selection.head,serialize)!.cursor,decorations:[{start,end:start+12,underline:false,strikethrough:false}]}})
  expect(editor.view.dom.querySelector<HTMLElement>('.claude-prompt-decoration')?.style.textDecorationLine).toBe('none')
  expect(editor.view.dom.querySelector<HTMLElement>('.claude-prompt-line-inherit')?.style.textDecorationLine).toBe('underline')
  expect(editor.view.dom.querySelector('u')?.textContent).toBe('Review notes and rollout')
  expect(editor.state.doc.eq(doc)).toBe(true);expect(editor.state.selection.eq(selection)).toBe(true)
  bridge.dispose()
})
