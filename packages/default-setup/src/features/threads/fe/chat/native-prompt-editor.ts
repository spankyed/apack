import type { Editor } from '@tiptap/core'
import { rewriteClaudePromptSource } from './native-prompt-source.ts'
import { createClaudePromptSuggestion } from './native-prompt-suggestion.ts'
import { createClaudePromptDecorations, drawClaudePromptDecorations } from './native-prompt-decorations.ts'
import { DOMParser as PromptDOMParser } from '@tiptap/pm/model'
import type { ClaudePromptHostRequest } from '#generated/types.ts'
import { TextSelection } from '@tiptap/pm/state'
import type { ClaudePromptEdit, ClaudePromptReply, ClaudePromptCompletionRequest, ClaudePromptCompletionReply, ClaudePromptCompletionRow } from '#generated/types.ts'
import { captureClaudePromptDocument, findClaudePromptPosition, rewriteClaudePromptDocument, type ClaudePromptDocument } from './native-prompt-document.ts'

/** A mounted view owns its revisions and listeners; it never owns the editor's lifetime. */
export function bindClaudePromptEditor(editor: Editor, send: (edit: ClaudePromptEdit) => void, onProblem: (message: string | undefined) => void, initialRevision = 0, completion?: { initialRevision?: number; request(event: ClaudePromptCompletionRequest): void; update(rows: ClaudePromptCompletionRow[], offerId?: string): void }, host?: { canSuggest(): boolean; viewport?: HTMLElement | null }) {
  const serialize = (doc: import('@tiptap/pm/model').Node): string =>
    (editor.storage as unknown as { markdown: { serializer: { serialize(doc: import('@tiptap/pm/model').Node): string } } }).markdown.serializer.serialize(doc)
  const parse = (text: string) => {
    const parser = (editor.storage as unknown as { markdown: { parser: { parse(text: string): string } } }).markdown.parser
    const template = document.createElement('template')
    template.innerHTML = parser.parse(text)
    return PromptDOMParser.fromSchema(editor.schema).parse(template.content)
  }
  const decorations = createClaudePromptDecorations()
  editor.registerPlugin(decorations.plugin)
  const suggestion = createClaudePromptSuggestion()
  editor.registerPlugin(suggestion.plugin)
  let revision = initialRevision, applying = false, disposed = false
  let completionRevision = completion?.initialRevision ?? 0
  let completionPending: { revision: number; snapshot: ClaudePromptDocument; selection: import('@tiptap/pm/state').Selection } | undefined
  let completionOffer: NonNullable<typeof completionPending> & { id: string; result: Extract<ClaudePromptCompletionReply, { status: 'ready' }>['result'] } | undefined
  function retireCompletions() { completionPending = undefined; completionOffer = undefined; completion?.update([]) }
  function askCompletions() {
    if (!completion || disposed || editor.isDestroyed || editor.view.composing) return
    const snapshot = captureClaudePromptDocument(editor.state.doc, editor.state.selection.head, serialize, editor.state.storedMarks ?? undefined)
    if (!snapshot) return
    const revision = ++completionRevision
    completionPending = { revision, snapshot, selection: editor.state.selection }
    try { completion.request({ revision, text: snapshot.text, cursor: snapshot.cursor }) } catch { retireCompletions() }
  }
  let fillPaint: { revision: number; text: string; drawn: ReturnType<typeof drawClaudePromptDecorations> } | undefined
  let settled = false
  let pending: { revision: number; snapshot: ClaudePromptDocument; selection: import('@tiptap/pm/state').Selection; done: Promise<boolean>; finish: (accepted: boolean) => void } | undefined
  let person = false, clearPerson: ReturnType<typeof setTimeout> | undefined
  let key: ClaudePromptEdit['key'], selectionKey: ClaudePromptEdit['key']
  const nativeKeys: Record<string, string> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'return', Escape: 'escape', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', PageUp: 'pageup', PageDown: 'pagedown', Home: 'home', End: 'end', Insert: 'insert' }
  const intent = (event?: Event) => {
    person = true
    if (event?.type === 'keydown') {
      const keyboard = event as KeyboardEvent
      key = keyboard.key && keyboard.key.length <= 32 ? { key: nativeKeys[keyboard.key] ?? (/^F\d{1,2}$/.test(keyboard.key) ? keyboard.key.toLowerCase() : keyboard.key), ...(keyboard.ctrlKey ? { ctrl: true as const } : {}), ...(keyboard.shiftKey ? { shift: true as const } : {}), ...(keyboard.metaKey ? { meta: true as const } : {}) } : undefined
      selectionKey = key
    } else if (event?.type !== 'beforeinput') { key = undefined; selectionKey = undefined }
    if (clearPerson) clearTimeout(clearPerson)
    clearPerson = setTimeout(() => { person = false; key = undefined }, 0)
  }
  const dom = editor.view.dom
  let revealFrame: number | undefined
  const revealFocusedCaret = () => {
    if (!disposed && !editor.isDestroyed && editor.isFocused && dom.ownerDocument.hasFocus() && !editor.view.composing) editor.view.dispatch(editor.state.tr.scrollIntoView())
  }
  const caretResize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
    if (revealFrame !== undefined) cancelAnimationFrame(revealFrame)
    revealFrame = requestAnimationFrame(() => { revealFrame = undefined; revealFocusedCaret() })
  })
  caretResize?.observe(dom)
  if (dom.parentElement) caretResize?.observe(dom.parentElement)
  if (host?.viewport) caretResize?.observe(host.viewport)
  const stopCaretReveal = () => { caretResize?.disconnect(); if (revealFrame !== undefined) cancelAnimationFrame(revealFrame) }
  const events = ['beforeinput', 'keydown', 'paste', 'drop', 'pointerdown'] as const
  for (const event of events) dom.addEventListener(event, intent, true)
  // A native reply can arrive between browser caret movement and selectionchange delivery.
  // Adopt that visible selection before any acknowledgement transaction paints the old one.
  function synchronizeSelection(): void {
    if (disposed || applying || editor.isDestroyed || editor.view.composing || dom.ownerDocument.activeElement !== dom) return
    const selection = dom.ownerDocument.getSelection()
    if (!selection?.anchorNode || !selection.focusNode || !dom.contains(selection.anchorNode) || !dom.contains(selection.focusNode)) return
    let anchor: number, head: number
    try {
      anchor = editor.view.posAtDOM(selection.anchorNode, selection.anchorOffset)
      head = editor.view.posAtDOM(selection.focusNode, selection.focusOffset)
    } catch { return } // Leave an unfinished browser content mutation to ProseMirror's observer.
    if (anchor < 0 || head < 0 || anchor > editor.state.doc.content.size || head > editor.state.doc.content.size) return
    if (anchor === editor.state.selection.anchor && head === editor.state.selection.head) return
    const observedKey = selectionKey
    intent(); key = observedKey; selectionKey = observedKey
    const next = TextSelection.between(editor.state.doc.resolve(anchor), editor.state.doc.resolve(head))
    editor.view.dispatch(editor.state.tr.setSelection(next).setMeta('claude-prompt-by', 'person'))
  }
  // Browser selection changes can arrive in a later task than their key/pointer event.
  // Capture before ProseMirror's document observer publishes the resulting selection.
  const selectionChanged = () => {
    const selection = dom.ownerDocument.getSelection()
    if (dom.ownerDocument.activeElement !== dom || !selection?.anchorNode || !selection.focusNode || !dom.contains(selection.anchorNode) || !dom.contains(selection.focusNode)) {
      person = false; key = undefined; selectionKey = undefined; return
    }
    const observedKey = selectionKey
    intent(); key = observedKey; selectionKey = observedKey
    synchronizeSelection()
  }
  // Formatting may precede Chromium's deferred selectionchange after Shift+Arrow.
  // Use the visible range before a mark shortcut consumes the model selection.
  const formattingKey = (event: KeyboardEvent) => {
    if (!event.isComposing && !event.altKey && (event.ctrlKey || event.metaKey) && ['b', 'i'].includes(event.key.toLowerCase())) synchronizeSelection()
  }
  dom.addEventListener('keydown', formattingKey, true)
  dom.ownerDocument.addEventListener('selectionchange', selectionChanged, true)

  function finishPending(accepted: boolean) {
    settled = accepted
    pending?.finish(accepted)
    pending = undefined
  }
  function publish(by?: 'app' | 'person') {
    if (applying) selectionKey = undefined
    if (disposed || applying || editor.isDestroyed) return
    finishPending(false)
    retireCompletions()
    if (editor.view.composing) return
    const snapshot = captureClaudePromptDocument(editor.state.doc, editor.state.selection.head, serialize, editor.state.storedMarks ?? undefined)
    revision++
    if (fillPaint?.revision !== revision) fillPaint = undefined
    let finish!: (accepted: boolean) => void
    const done = new Promise<boolean>(resolve => { finish = resolve })
    pending = snapshot ? { revision, snapshot, selection: editor.state.selection, done, finish } : undefined
    if (!snapshot) { onProblem('Claude prompt hooks cannot map this editor selection'); return }
    onProblem(undefined)
    const origin = by ?? (person ? 'person' : 'app')
    selectionKey = undefined
    try { send({ revision, text: snapshot.text, cursor: snapshot.cursor, by: origin, ...(origin === 'person' && key ? { key } : {}) }) }
    catch (error) { finishPending(false); onProblem(error instanceof Error ? error.message : 'Claude input could not be sent') }
  }
  function prepareDraft(input: Extract<ClaudePromptHostRequest, { kind: 'fill' }>['input'], expectedRevision: number) {
    if (disposed || editor.isDestroyed || editor.view.composing || revision !== expectedRevision) return
    const snapshot = captureClaudePromptDocument(editor.state.doc, editor.state.selection.head, serialize, editor.state.storedMarks ?? undefined)
    if (!snapshot || input.ifEmpty && snapshot.text !== '') return
    const offset = input.mode === 'replace' ? 0 : input.mode === 'append' ? snapshot.text.length : snapshot.cursor
    const text = input.mode === 'replace' ? input.text : snapshot.text.slice(0, offset) + input.text + snapshot.text.slice(offset)
    const cursor = offset + input.text.length
    const runs = (input.decorations ?? []).map(run => ({ ...run, start: run.start + offset, end: run.end + offset }))
    let parserRefused = false
    const parseFill = (value: string) => { try { return parse(value) } catch (error) { parserRefused = true; throw error } }
    let next = rewriteClaudePromptDocument(snapshot, { text, cursor }, serialize, parseFill, runs.flatMap(run => [run.start, run.end]))
    if (parserRefused) return
    if (!next && input.mode === 'replace') {
      // A full replacement may release old atoms; prefer a rich result when its caret is representable.
      try {
        const empty = parseFill(''), blank = captureClaudePromptDocument(empty, 1, serialize)
        if (blank) next = rewriteClaudePromptDocument(blank, { text, cursor }, serialize, parseFill, runs.flatMap(run => [run.start, run.end]))
      } catch { return }
      if (parserRefused) return
    }
    next ??= rewriteClaudePromptSource(snapshot, { text, cursor }, serialize, input.mode === 'replace')
    if (!next) {
      let atoms = false
      snapshot.doc.descendants(node => { if (node.isAtom && !node.isText) atoms = true })
      if (atoms && input.mode !== 'replace') return
      // Parse through the existing Markdown extension, once, into an inert template.
      const parser = (editor.storage as unknown as { markdown: { parser: { parse(text: string): string } } }).markdown.parser
      try {
        const template = document.createElement('template')
        template.innerHTML = parser.parse(text)
        const doc = PromptDOMParser.fromSchema(editor.schema).parse(template.content)
        const position = findClaudePromptPosition(doc, cursor, serialize)
        if (serialize(doc) !== text || position === undefined) return
        next = { doc, position }
      } catch { return }
    }
    return { next, text, offset, runs, before: snapshot.text }
  }
  function placeDraft(input: Extract<ClaudePromptHostRequest, { kind: 'fill' }>['input'], expectedRevision: number, origin: 'app' | 'person'): boolean {
    const prepared = prepareDraft(input, expectedRevision)
    if (!prepared) return false
    const { next, runs } = prepared
    const drawn = drawClaudePromptDecorations(next.doc, runs, serialize, next.sourcePositions, next.sourceOffsets)
    fillPaint = origin === 'app' ? { revision: revision + 1, text: serialize(next.doc), drawn } : undefined
    const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, next.doc.content)
    tr.setSelection(TextSelection.create(tr.doc, next.position)).setStoredMarks(next.storedMarks ?? null).setMeta('claude-prompt-by', origin)
    tr.setMeta(decorations.key, drawn)
    if (next.doc.firstChild?.type.name === 'claudePromptSource' && dom.ownerDocument.hasFocus()) tr.scrollIntoView()
    editor.view.dispatch(tr)
    if (fillPaint?.revision === revision) fillPaint = { ...fillPaint, text: serialize(editor.state.doc), drawn: decorations.key.getState(editor.state) ?? drawn }
    return true
  }
  function dismissSuggestion() {
    if (!disposed && !editor.isDestroyed && suggestion.key.getState(editor.state)) editor.view.dispatch(editor.state.tr.setMeta(suggestion.key, null))
  }
  function acceptSuggestion(event: KeyboardEvent) {
    if (disposed || editor.isDestroyed || event.defaultPrevented || event.isComposing || editor.view.composing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !['Tab', 'ArrowRight'].includes(event.key) || (host && !host.canSuggest())) return
    const text = suggestion.key.getState(editor.state)
    if (text && editor.isEmpty && placeDraft({ mode: 'replace', text }, revision, 'person')) {
      event.preventDefault(); event.stopImmediatePropagation()
    }
  }
  const transaction = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => {
    if (transaction.docChanged || transaction.selectionSet) publish(transaction.getMeta('claude-prompt-by'))
  }
  const compositionEnd = () => { intent(); publish() }
  const destroyed = () => { stopCaretReveal(); finishPending(false) }
  editor.on('destroy', destroyed)
  editor.on('transaction', transaction)
  dom.addEventListener('compositionend', compositionEnd)
  dom.addEventListener('compositionstart', dismissSuggestion)
  dom.addEventListener('keydown', acceptSuggestion, true)
  window.addEventListener('blur', dismissSuggestion)
  publish()
  return {
    get revision() { return revision },
    readDraft() {
      synchronizeSelection()
      if (disposed || editor.isDestroyed || editor.view.composing) return
      const snapshot = captureClaudePromptDocument(editor.state.doc, editor.state.selection.head, serialize, editor.state.storedMarks ?? undefined)
      return snapshot ? { text: snapshot.text, cursor: snapshot.cursor } : undefined
    },
    fillDraft(input: Extract<ClaudePromptHostRequest, { kind: 'fill' }>['input'], expectedRevision: number): boolean {
      return placeDraft(input, expectedRevision, 'app')
    },
    showSuggestion(text: string, expectedRevision: number): boolean {
      if (disposed || editor.isDestroyed || editor.view.composing || revision !== expectedRevision || !editor.isEmpty || !text.trim() || text.length > 1000000 || (host && !host.canSuggest())) return false
      const prepared = prepareDraft({ mode: 'replace', text }, expectedRevision)
      if (!prepared || prepared.before !== '') return false
      editor.view.dispatch(editor.state.tr.setMeta(suggestion.key, text))
      return true
    },
    dismissSuggestion() { dismissSuggestion() },
    /** Settle this edit only; newer edits retire this send intent instead of joining it. */
    settle(): Promise<boolean> { return pending?.done ?? Promise.resolve(settled && !disposed && !editor.isDestroyed && !editor.view.composing) },
    receive(reply: ClaudePromptReply) {
      if (disposed || !pending || reply.revision !== pending.revision || editor.isDestroyed) return
      if (editor.view.composing) { finishPending(false); return }
      synchronizeSelection()
      if (!pending || reply.revision !== pending.revision) return
      const { snapshot, selection } = pending
      if (editor.state.doc !== snapshot.doc || !editor.state.selection.eq(selection)) { finishPending(false); return }
      if (reply.status === 'error') { onProblem(reply.message); finishPending(false); return }
      if (reply.frame.superseded) { finishPending(false); return }
      const next = rewriteClaudePromptDocument(snapshot, reply.frame, serialize, parse, reply.frame.decorations?.flatMap(run => [run.start, run.end])) ?? rewriteClaudePromptSource(snapshot, reply.frame, serialize)
      if (!next) { onProblem('Claude prompt rewrite cannot be represented without changing editor structure'); finishPending(false); return }
      applying = true
      try {
        const tr = editor.state.tr
        if (next.doc !== snapshot.doc) tr.replaceWith(0, tr.doc.content.size, next.doc.content)
        // A text/cursor acknowledgment carries no selection-range change.
        if (next.doc !== snapshot.doc || reply.frame.cursor !== snapshot.cursor) tr.setSelection(TextSelection.create(tr.doc, next.position)).setStoredMarks(next.storedMarks ?? null)
        // Native app adoption returns only text/cursor. It acknowledges this fill, not a new edit.
        const drawn = reply.frame.decorations ? drawClaudePromptDecorations(tr.doc, reply.frame.decorations, serialize, next.sourcePositions, next.sourceOffsets) : fillPaint?.revision === reply.revision && fillPaint.text === reply.frame.text ? fillPaint.drawn : drawClaudePromptDecorations(tr.doc, [], serialize)
        tr.setMeta(decorations.key, drawn)
        fillPaint = next.normalized ? { revision: revision + 1, text: serialize(tr.doc), drawn } : undefined
        if (next.doc.firstChild?.type.name === 'claudePromptSource' && editor.isFocused && dom.ownerDocument.hasFocus()) tr.scrollIntoView()
        editor.view.dispatch(tr)
        if (fillPaint) fillPaint = { ...fillPaint, text: serialize(editor.state.doc), drawn: decorations.key.getState(editor.state) ?? drawn }
        onProblem(undefined)
        finishPending(true)
        if (!next.normalized) askCompletions()
      } catch (error) {
        finishPending(false)
        onProblem(error instanceof Error ? error.message : 'Claude input could not be applied')
      } finally { applying = false }
      // Rich Markdown has one canonical spelling; adopt it without another person-hook pass.
      if (next.normalized) publish('app')
    },
    receiveCompletions(reply: ClaudePromptCompletionReply) {
      const pending = completionPending
      if (!pending || disposed || editor.isDestroyed || reply.revision !== pending.revision) return
      completionPending = undefined
      if (reply.status !== 'ready' || reply.result.superseded || editor.state.doc !== pending.snapshot.doc || !editor.state.selection.eq(pending.selection)) { retireCompletions(); return }
      completionOffer = { ...pending, id: crypto.randomUUID(), result: reply.result }
      completion?.update(reply.result.suggestions, completionOffer.id)
    },
    dismissCompletions() { retireCompletions() },
    selectCompletion(index: number, offerId: string): boolean {
      const offer = completionOffer, row = offer?.result.suggestions[index]
      if (!offer || offer.id !== offerId || !row || disposed || editor.isDestroyed || editor.state.doc !== offer.snapshot.doc || !editor.state.selection.eq(offer.selection) || offer.result.start === undefined) return false
      const { snapshot, result } = offer, start = result.start!
      const next = rewriteClaudePromptDocument(snapshot, { text: snapshot.text.slice(0, start) + row.text + snapshot.text.slice(snapshot.cursor), cursor: start + row.text.length }, serialize, parse)
      retireCompletions()
      if (!next) { onProblem('Claude completion cannot replace this token without changing editor structure'); return false }
      const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, next.doc.content)
      tr.setSelection(TextSelection.create(tr.doc, next.position)).setStoredMarks(next.storedMarks ?? null).setMeta('claude-prompt-by', 'app')
      editor.view.dispatch(tr)
      editor.view.focus()
      return true
    },
    dispose() {
      stopCaretReveal()
      disposed = true; selectionKey = undefined; fillPaint = undefined; finishPending(false); retireCompletions()
      if (clearPerson) clearTimeout(clearPerson)
      editor.off('transaction', transaction)
      editor.off('destroy', destroyed)
      if (!editor.isDestroyed) { editor.unregisterPlugin(decorations.key); editor.unregisterPlugin(suggestion.key) }
      for (const event of events) dom.removeEventListener(event, intent, true)
      dom.ownerDocument.removeEventListener('selectionchange', selectionChanged, true)
      dom.removeEventListener('keydown', formattingKey, true)
      dom.removeEventListener('compositionend', compositionEnd)
      dom.removeEventListener('compositionstart', dismissSuggestion)
      dom.removeEventListener('keydown', acceptSuggestion, true)
      window.removeEventListener('blur', dismissSuggestion)
    },
  }
}
