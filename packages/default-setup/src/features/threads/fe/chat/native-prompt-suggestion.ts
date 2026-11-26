import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** Ghost text is an inert widget; it never becomes draft content until explicitly accepted. */
export function createClaudePromptSuggestion() {
  const key = new PluginKey<string | undefined>('claude-native-suggestion')
  const plugin = new Plugin<string | undefined>({
    key,
    state: {
      init: () => undefined,
      apply(tr, value, previous) {
        const text = tr.getMeta(key)
        if (text === null) return undefined
        if (typeof text === 'string') return text
        return tr.docChanged || (tr.selectionSet && !tr.selection.eq(previous.selection)) ? undefined : value
      },
    },
    props: {
      decorations(state) {
        const text = key.getState(state)
        if (!text || state.doc.textContent) return DecorationSet.empty
        return DecorationSet.create(state.doc, [Decoration.widget(Selection.atStart(state.doc).from, () => {
          const span = document.createElement('span')
          span.className = 'claude-prompt-suggestion'
          span.textContent = text
          span.contentEditable = 'false'
          span.setAttribute('aria-hidden', 'true')
          span.style.cssText = 'opacity:0.5;pointer-events:none;user-select:none;white-space:pre-wrap'
          return span
        }, { side: -1, ignoreSelection: true })])
      },
    },
    view(view) {
      const update = () => { if (key.getState(view.state)) view.dom.setAttribute('data-native-suggestion', 'true'); else view.dom.removeAttribute('data-native-suggestion') }
      update()
      return { update, destroy: () => view.dom.removeAttribute('data-native-suggestion') }
    },
  })
  return { key, plugin }
}
