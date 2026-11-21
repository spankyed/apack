// An ask a component makes itself, for a component with no machine to hold the answer: a dialog that fetches what it
// shows, a button whose label waits on a write. A surface's machine invokes `fromAsk` instead.
import { getCurrentScope, onScopeDispose, shallowReactive, shallowReadonly } from 'vue'

/** What `useAsk` hands a component: the ask to make, and how the last one stands */
export interface AskState<Args extends unknown[], O> {
  /** Makes the ask, and answers with how it ended. A later one supersedes it: its outcome is not taken */
  ask(...args: Args): Promise<O>
  /** Whether an ask is under way */
  readonly pending: boolean
  /** How the last ask ended, until another is made; nothing before the first */
  readonly outcome: O | undefined
}

/**
 * Follows the asks a component makes with `run` — the `ask` from its pack's `#generated/events`, bound to one ask:
 *
 * ```ts
 * const rename = useAsk((name: string) => ask('library', { type: 'RENAME_ITEM', id, name, itemType: 'folder' }))
 * // rename.pending, rename.outcome, await rename.ask('Notes')
 * ```
 *
 * The latest ask is the one that counts: an earlier one still under way when another is made, or when the component
 * goes, has its answer ignored here, and gives up waiting for it. The handler that answers goes on regardless.
 */
export function useAsk<Args extends unknown[], O>(run: (...args: Args) => Promise<O>): AskState<Args, O> {
  if (!getCurrentScope()) {
    throw new Error('useAsk follows its asks until the component goes, so it is called in a component\'s setup, not in a handler or a computed')
  }
  const state = shallowReactive<{ pending: boolean; outcome: O | undefined }>({ pending: false, outcome: undefined })
  let latest = 0
  let gone = false
  onScopeDispose(() => { gone = true })
  const ask = async (...args: Args): Promise<O> => {
    const mine = ++latest
    state.pending = true
    try {
      const outcome = await run(...args)
      if (!gone && mine === latest) state.outcome = outcome
      return outcome
    } finally {
      if (!gone && mine === latest) state.pending = false
    }
  }
  const view = shallowReadonly(state)
  return {
    ask,
    get pending() { return view.pending },
    get outcome() { return view.outcome as O | undefined },
  }
}
