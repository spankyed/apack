import { shallowRef, toRaw, type ShallowRef } from 'vue'

export interface EditorCompletionRow { text: string; label?: string; description?: string; select(): boolean }

export interface EditorCompletionOffer {
  id: string
  rows: EditorCompletionRow[]
  dismiss(): void
}
const offers = new WeakMap<object, ShallowRef<EditorCompletionOffer | undefined>>()
function state(editor: object) {
  editor = toRaw(editor)
  let value = offers.get(editor)
  if (!value) { value = shallowRef<EditorCompletionOffer>(); offers.set(editor, value) }
  return value
}
/** Each editor has one view-owned offer; host popups append it after their own rows. */
export function getEditorCompletionOffer(editor: object): Readonly<ShallowRef<EditorCompletionOffer | undefined>> { return state(editor) }
export function setEditorCompletionOffer(editor: object, offer: EditorCompletionOffer | undefined): void { state(editor).value = offer }

const commandHolds = new WeakMap<object, Set<symbol>>()
/** Hold app command matching until this owner's release; other owners retain their holds. */
export function holdEditorCommandSuggestions(editor: object): () => void {
  editor = toRaw(editor)
  let holds = commandHolds.get(editor)
  if (!holds) { holds = new Set(); commandHolds.set(editor, holds) }
  const ownedHolds = holds, token = Symbol('editor-command-hold')
  ownedHolds.add(token)
  return () => {
    if (!ownedHolds.delete(token)) return
    if (!ownedHolds.size && commandHolds.get(editor) === ownedHolds) commandHolds.delete(editor)
  }
}
export function getEditorCommandSuggestionsEnabled(editor: object): boolean {
  return !commandHolds.get(toRaw(editor))?.size
}
