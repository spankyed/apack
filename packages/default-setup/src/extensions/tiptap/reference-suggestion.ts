import { nativePromptEditors } from './native-prompt-scope.ts'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { getReferenceCategoryDeclarations } from '@apackdev/sdk/fe/references'

export interface ReferenceSuggestionState {
  active: boolean
  triggerPos: number
  query: string
  level: 'category' | 'items'
  selectedCategory: string | null
  categoryQuery: string
}

export const referenceSuggestionKey = new PluginKey<ReferenceSuggestionState>('referenceSuggestion')

const defaultState: ReferenceSuggestionState = {
  active: false,
  triggerPos: 0,
  query: '',
  level: 'category',
  selectedCategory: null,
  categoryQuery: '',
}

function plugin(editor: Editor): Plugin<ReferenceSuggestionState> {
  return new Plugin<ReferenceSuggestionState>({
    key: referenceSuggestionKey,

    state: {
      init() {
        return { ...defaultState }
      },

      apply(tr, prev) {
        if (nativePromptEditors.has(editor)) return { ...defaultState }
        const meta = tr.getMeta(referenceSuggestionKey)
        if (meta) {
          if (meta.deactivate) return { ...defaultState }
          return { ...prev, ...meta }
        }

        if (!editor.isEditable) return { ...defaultState }

        if (!tr.docChanged && !tr.selectionSet) return prev

        const { $head } = tr.selection
        const textBefore = $head.parent.textBetween(0, $head.parentOffset, undefined, '￼')

        const hashIndex = textBefore.lastIndexOf('#')

        if (hashIndex === -1) {
          return prev.active ? { ...defaultState } : prev
        }

        const afterHash = textBefore.slice(hashIndex + 1)

        if (afterHash.includes(' ')) {
          return prev.active ? { ...defaultState } : prev
        }

        if (afterHash && !/^[\w:-]*$/i.test(afterHash)) {
          return prev.active ? { ...defaultState } : prev
        }

        const start = $head.start()
        const triggerPos = start + hashIndex

        if (prev.active && prev.triggerPos !== triggerPos) {
          return {
            active: true,
            triggerPos,
            query: afterHash,
            level: 'category',
            selectedCategory: null,
            categoryQuery: '',
          }
        }

        if (prev.active && prev.level === 'items' && prev.selectedCategory) {
          const itemQuery = afterHash.slice(prev.categoryQuery.length)
          return {
            ...prev,
            active: true,
            query: itemQuery,
          }
        }

        if (!prev.active || prev.level === 'category') {
          const categoryCheck = afterHash.endsWith(':') ? afterHash.slice(0, -1) : afterHash
          if (categoryCheck && !getReferenceCategoryDeclarations().some(c => c.declaration.label.toLowerCase().includes(categoryCheck.toLowerCase()))) {
            return prev.active ? { ...defaultState } : prev
          }
        }

        return {
          ...prev,
          active: true,
          triggerPos,
          query: afterHash,
        }
      },
    },

  })
}

/** Suggestions use the host's reference node without owning the stored document schema. */
export const ReferenceSuggestion = Extension.create({
  name: 'referenceSuggestion',

  addProseMirrorPlugins() {
    return [plugin(this.editor)]
  },
})
