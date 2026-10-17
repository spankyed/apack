import { shallowRef, toRaw, type ShallowRef } from 'vue'
import type { Editor } from '@tiptap/core'
import type { ClaudePromptCompletionRow } from '#generated/types.ts'

export interface ClaudeCompletionOffer {
  id: string
  rows: (ClaudePromptCompletionRow & { select(): boolean })[]
  dismiss(): void
}
const offers = new WeakMap<Editor, ShallowRef<ClaudeCompletionOffer | undefined>>()
function state(editor: Editor) {
  editor = toRaw(editor)
  let value = offers.get(editor)
  if (!value) { value = shallowRef<ClaudeCompletionOffer>(); offers.set(editor, value) }
  return value
}
/** Each editor has one view-owned offer; host popups append it after their own rows. */
export function getClaudeCompletionOffer(editor: Editor): Readonly<ShallowRef<ClaudeCompletionOffer | undefined>> { return state(editor) }
export function setClaudeCompletionOffer(editor: Editor, offer: ClaudeCompletionOffer | undefined): void { state(editor).value = offer }
