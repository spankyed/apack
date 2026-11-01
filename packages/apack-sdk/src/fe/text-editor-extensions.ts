// Text editor extension points: a pack contributes tiptap extensions, popups and a suggestion
// predicate through PackFERegistration, and provides extra block items. Pack FE code gets the host's
// copy through @apackdev/sdk/fe.
import type { InjectionKey, Component } from 'vue'
import type { AnyExtension, Editor } from '@tiptap/vue-3'
import type { EditorState } from '@tiptap/pm/state'
import { boundFeHost } from '../runtime/fe-host.ts'

export interface BlockItem {
  label: string
  icon: Component
  command: (e: Editor) => void
}

/** A read-only message renderer owns each returned DOM cleanup until replacement/unmount. */
export interface ReadOnlyTextRenderer {
  readonly transformMarkdown?: (source: string) => string
  readonly decorate?: (root: HTMLElement) => void | (() => void)
}

export interface TextEditorExtensions {
  readonly readOnly?: false | ReadOnlyTextRenderer
  readonly extensions?: Readonly<Record<string, AnyExtension>>
  readonly popups?: Readonly<Record<string, Component>>
  readonly isSuggestionActive?: (state: EditorState) => boolean
}

/** One accepted editor group; declarations and unavailable groups belong to the catalog. */
export interface TextEditorExtensionsBinding {
  readonly packId: string
  readonly groupId: string
  readonly binding: TextEditorExtensions
}

export const EXTRA_BLOCK_ITEMS_KEY: InjectionKey<BlockItem[]> = Symbol('extraBlockItems')

// The text editor extensions the renderer's registered pack frontends contribute
export const textEditorExtensionsRegistry = {
  getAll(): TextEditorExtensionsBinding[] {
    return boundFeHost().packs.textEditor();
  },
  /** Observe committed frontend changes; reread bindings and compare their identities. */
  onChanged(listener: () => void): () => void {
    return boundFeHost().packs.onChanged(listener);
  },
};
