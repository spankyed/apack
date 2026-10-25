// A view, live in a component: the frontend half of a feature's views (`defineViews`, `@apackdev/sdk/framework`).
// The window subscribes over its client to the API (`FeClient.watchView`), which sends this window, and only this
// window, the view's result and each changed result after it. The component reads the state this hands back; no
// surface machine keeps a copy of the rows.
//
// `useView` from a pack's `#generated/fe` is the typed door, checking the feature, the view's name, its arguments
// and its result against the declaration. This is its untyped twin, for a view named by data or another pack's.
import { getCurrentScope, onScopeDispose, shallowReactive, shallowReadonly, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { boundFeHost } from '../runtime/fe-host.ts'
import { viewKey, type ViewRequest } from '../framework/views.ts'

/** A view as a component reads it. Reactive: read its members where they're used, not destructured in setup. */
export interface ViewState<Result> {
  /**
   * `idle` while its arguments are `null` or `undefined`, `loading` until the first result for these arguments,
   * `ready` with one, `error` when the view threw or its pack isn't running
   */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  /**
   * The last result for these arguments, kept through an error so a view that briefly fails doesn't blank what it
   * showed; `undefined` while idle and until the first result. New arguments start again from `undefined`.
   */
  readonly data: Result | undefined;
  /** Why there's no result, while `status` is `error` */
  readonly error: string | undefined;
  /** The last commit the state reflects (`Ears.lastCommit`), or 0 before any */
  readonly commit: number;
}

/** How a view follows its arguments */
export interface UseViewOptions {
  /**
   * Keep showing the last result while the result for new arguments loads, rather than starting again from
   * `undefined`: for a list that pages further or filters, where blanking between pages is wrong. A view that asks
   * for something else entirely (another prompt) leaves it off, so it never shows one row under another's name.
   */
  keepPrevious?: boolean;
}

/**
 * The view `view` of the feature at `ref`, followed until the calling scope is disposed — so it runs in a component's
 * setup or an effect scope, never inside a `computed`.
 *
 * With `args`, a ref or a getter is followed too, and a change that asks for something different (compared as data,
 * so a new object holding the same values asks for nothing new) subscribes again; `null` or `undefined` unsubscribes
 * and leaves the view `idle`. Without, the view takes no arguments. New arguments start from no result unless `options`
 * keeps the previous one (`keepPrevious`).
 */
export function untypedUseView<Result = unknown>(
  ref: string,
  view: string,
  ...args: [] | [args: MaybeRefOrGetter<unknown>, options?: UseViewOptions]
): ViewState<Result> {
  if (!getCurrentScope()) {
    throw new Error(`useView("${ref}", "${view}") runs in a component's setup or an effect scope: it follows the view until that scope is disposed`)
  }
  const state = shallowReactive<{ -readonly [K in keyof ViewState<Result>]: ViewState<Result>[K] }>({
    status: 'idle', data: undefined, error: undefined, commit: 0,
  })
  const takesArgs = args.length > 0
  let stop: (() => void) | undefined

  // The request the arguments ask for now, or nothing; its key is what decides whether anything new was asked
  const current = (): ViewRequest | undefined => {
    if (!takesArgs) return { ref, view }
    const value = toValue(args[0])
    return value === null || value === undefined ? undefined : { ref, view, args: value }
  }

  watch(() => {
    const request = current()
    return request ? viewKey(request) : undefined
  }, () => {
    stop?.()
    stop = undefined
    state.error = undefined
    const request = current()
    if (!request || !args[1]?.keepPrevious) state.data = undefined
    if (!request) {
      state.status = 'idle'
      return
    }
    state.status = 'loading'
    let open = true
    const unsubscribe = boundFeHost().client.watchView(request, (update) => {
      if (!open) return
      // A failed subscription knows no commit and says 0, which mustn't move the state back
      state.commit = Math.max(state.commit, update.commit)
      if (update.ok) {
        state.status = 'ready'
        state.data = update.value as Result
        state.error = undefined
      } else {
        state.status = 'error'
        state.error = update.error
      }
    })
    stop = () => {
      open = false
      unsubscribe()
    }
  }, { immediate: true })

  onScopeDispose(() => stop?.())
  return shallowReadonly(state)
}
