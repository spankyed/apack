import { Editor, Node } from '@tiptap/core'
import { bindClaudePromptEditor } from '#features/threads/fe/chat/native-prompt-editor.ts'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
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
  bridge.receive({ revision: 1, status: 'applied', frame: { text: '**safe**', cursor: 4 } })
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


it('can detach after the editor has already been destroyed', () => {
  const bridge = bindClaudePromptEditor(editor, vi.fn(), vi.fn())
  editor.destroy()
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
