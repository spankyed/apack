import { nativePromptEditors } from './native-prompt-scope.ts'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Extension, type Editor } from '@tiptap/core'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { getCommands, type PackCommand } from '@apackdev/sdk/commands'

export interface CommandSuggestionState {
  active: boolean
  query: string
  selectedCommand: PackCommand | null
  previousCommand: PackCommand | null
}

/** The `/` trigger is always at ProseMirror position 1 (start of first-paragraph content). */
export const COMMAND_TRIGGER_POS = 1

const defaultState: CommandSuggestionState = {
  active: false,
  query: '',
  selectedCommand: null,
  previousCommand: null,
}

export const commandSuggestionKey = new PluginKey<CommandSuggestionState>('commandSuggestion')

/**
 * Command Suggestion Plugin — Behavioral Specs
 *
 * Lifecycle:
 *   - Activates when the first paragraph starts with `/`
 *   - Two phases: QUERY phase (filtering commands) and SELECTED phase (command chosen)
 *   - Deactivates via Escape, clearing the `/`, or when no command matches
 *
 * Query phase (`active && !selectedCommand`):
 *   - `/` alone → popup shows all commands
 *   - `/gc` → popup filters to matching commands
 *   - `/ ` (slash-space, no match) → deactivates, text stays as regular input
 *   - `/gc ` (slash-query-space, exact match) → transitions to selected phase
 *   - Leading whitespace before `/` is tolerated and auto-stripped
 *   - Trailing whitespace is auto-stripped during query phase (appendTransaction)
 *
 * Selected phase (`active && selectedCommand`):
 *   - `/{commandName} {body}` — prefix is locked, body is free text
 *   - Backspacing into the command name → re-enters query phase with partial text
 *   - Ctrl+Z restoring command text → re-selects via previousCommand tracking
 *
 * Paste / setContent:
 *   - Text like `/command body` pasted in → auto-matches command from known list
 *
 * Decorations:
 *   - `/commandName` (or `/query`) gets `command-segment` inline decoration
 *   - Placeholder shown on the paragraph node when command is selected and body is empty
 */
function plugin(
  editor: Editor,
  getCommands: () => PackCommand[],
): Plugin<CommandSuggestionState> {
  return new Plugin<CommandSuggestionState>({
    key: commandSuggestionKey,

    state: {
      init() {
        return { ...defaultState }
      },

      apply(tr, prev) {
        if (nativePromptEditors.has(editor)) return { ...defaultState }
        const deactivateIf = (active: boolean) => active ? { ...defaultState } : prev

        // Handle explicit meta updates (from popup interactions)
        const meta = tr.getMeta(commandSuggestionKey)
        if (meta) {
          if (meta.deactivate) return { ...defaultState }
          return { ...prev, ...meta }
        }

        if (!editor.isEditable) return { ...defaultState }

        if (!tr.docChanged && !tr.selectionSet) return prev

        // Use first paragraph text — the `/` and query are always in the first paragraph
        const firstParagraph = tr.doc.firstChild
        if (!firstParagraph) return deactivateIf(prev.active)

        const firstText = firstParagraph.textContent
        const trimmedText = firstText.trimStart()

        if (!trimmedText.startsWith('/')) {
          return deactivateIf(prev.active)
        }

        // Only activate from the first paragraph — commands live there exclusively
        const { $head } = tr.selection
        const isFirstParagraph = $head.depth === 1 && $head.index(0) === 0
        if (!isFirstParagraph && !prev.active) return prev

        // Selected phase: stay active while the `/{name} ` prefix is intact.
        // If the user backspaces into the command name, drop back to query phase
        // and stash the command as previousCommand (enables Ctrl+Z re-selection).
        if (prev.active && prev.selectedCommand) {
          const requiredPrefix = `/${prev.selectedCommand.name} `
          if (trimmedText.startsWith(requiredPrefix)) return prev
          const partialQuery = trimmedText.slice(1).split(' ')[0]
          return { ...prev, active: true, query: partialQuery, selectedCommand: null, previousCommand: prev.selectedCommand }
        }

        // Query phase: extract text after `/`
        const query = trimmedText.slice(1)

        // Paths (e.g. `/Users/foo/bar`) contain extra slashes — not commands
        if (query.includes('/')) {
          return deactivateIf(prev.active)
        }

        // `/` alone (length 0) → stay active, show all commands.
        // `/ ` (length 1, space) → falls through to space check below → deactivates.
        // Using `query.length` (not `query.trim().length`) avoids a feedback loop
        // where appendTransaction strips the space and apply re-evaluates as empty.
        if (query.length === 0) {
          return { ...prev, active: true, query: '' }
        }

        // Space in query means one of three things:
        // 1. Ctrl+Z restored a previously selected command → re-select via previousCommand
        // 2. Query matches a known command exactly → transition to selected phase
        // 3. No match → deactivate (e.g., `/ ` or `/foo ` where foo isn't a command)
        if (query.includes(' ')) {
          // Path 1: re-select after Ctrl+Z restores command text
          if (prev.previousCommand) {
            const requiredPrefix = `${prev.previousCommand.name} `
            if (query.startsWith(requiredPrefix)) {
              return { ...prev, active: true, selectedCommand: prev.previousCommand, previousCommand: null }
            }
          }

          // Path 2: exact match against known commands (also handles paste/setContent)
          const queryName = query.split(' ')[0]
          const matched = getCommands().find(cmd => cmd.name === queryName)
          if (matched) {
            return { ...prev, active: true, query: '', selectedCommand: matched, previousCommand: null }
          }

          // Path 3: no command match → deactivate
          return deactivateIf(prev.active)
        }

        return {
          ...prev,
          active: true,
          query,
        }
      },
    },

    // Normalization pass: strip whitespace to keep `/query` clean, collapse extra
    // paragraphs (e.g., from paste) into the first paragraph.
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some(tr => tr.docChanged)) return null

      const firstText = newState.doc.firstChild?.textContent ?? ''
      if (!firstText.trimStart().startsWith('/')) return null

      const suggestionState = commandSuggestionKey.getState(newState)
      if (!suggestionState?.active) return null
      // Only strip trailing whitespace in query phase — in selected phase the
      // body after the command prefix is free-form and whitespace is intentional.
      const inQueryPhase = suggestionState?.active && !suggestionState.selectedCommand

      // Determine desired text: strip leading whitespace always, trailing in query phase
      const targetText = inQueryPhase ? firstText.trim() : firstText.trimStart()
      const needsTrim = targetText !== firstText && targetText.length > 0

      // Collapse extra paragraphs only in query phase (e.g. pasted multi-line text).
      // In selected phase, the body supports multiple lines via Shift+Enter.
      let needsCollapse = false
      if (inQueryPhase && newState.doc.childCount > 1) {
        const rest = newState.doc.textContent.slice(firstText.length)
        if (rest.trim().length === 0) needsCollapse = true
      }

      if (!needsTrim && !needsCollapse) return null

      // Single paragraph rebuild
      const { tr } = newState
      const paragraph = newState.schema.nodes.paragraph.create(
        null,
        targetText ? newState.schema.text(targetText) : null,
      )
      const replaceEnd = needsCollapse
        ? newState.doc.content.size
        : newState.doc.firstChild!.nodeSize
      tr.replaceWith(0, replaceEnd, paragraph)
      tr.setSelection(TextSelection.atEnd(tr.doc))
      return tr
    },

    props: {
      // Escape → deactivate command mode entirely (text remains as regular input)
      handleKeyDown(view, event) {
        if (event.key !== 'Escape') return false

        const suggestionState = commandSuggestionKey.getState(view.state)
        if (!suggestionState?.active) return false

        const { tr } = view.state
        tr.setMeta(commandSuggestionKey, { deactivate: true })
        view.dispatch(tr)
        return true
      },

      decorations(state) {
        const suggestionState = commandSuggestionKey.getState(state)
        if (!suggestionState?.active) return DecorationSet.empty

        const docText = state.doc.textContent
        const commandPrefix = suggestionState.selectedCommand
          ? `/${suggestionState.selectedCommand.name}`
          : `/${suggestionState.query}`

        const decos: Decoration[] = []

        // Inline decoration on the /commandName (or /query) text
        const cmdStart = COMMAND_TRIGGER_POS
        const cmdEnd = cmdStart + commandPrefix.length
        if (cmdEnd > cmdStart) {
          decos.push(Decoration.inline(cmdStart, cmdEnd, { class: 'command-segment' }))
        }

        // Only show placeholder if a command is selected and there's no body text after it
        const afterCommand = docText.slice(commandPrefix.length).replace(/^\s/, '')
        if (suggestionState.selectedCommand && !afterCommand) {
          const firstChild = state.doc.firstChild
          if (firstChild) {
            decos.push(Decoration.node(0, firstChild.nodeSize, {
              'data-command-placeholder': suggestionState.selectedCommand.placeholder,
              'class': 'has-command-placeholder',
            }))
          }
        }

        return DecorationSet.create(state.doc, decos)
      },
    },
  })
}

export const CommandSuggestion = Extension.create({
  name: 'commandSuggestion',

  addProseMirrorPlugins() {
    return [plugin(this.editor, getCommands)]
  },
})
