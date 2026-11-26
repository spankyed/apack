// Reading another surface's state by ref, untyped: the escape hatch beside the typed readers `#generated/fe`
// generates from each surface's contract, as `untypedQuery` is beside `query`.
//
// `useSurface()` answers "the surface I am rendered by", which needs a `SurfaceScope`. Extension components —
// artifact viewers, tiptap command items, step forms — are rendered by the host wherever they belong, with no such
// scope. They reach a surface by its ref instead.
//
// Both return `TSelected | undefined`, because a ref is a name and nothing about a name says the surface is running:
// another pack's frontend may still be loading. The generated readers narrow that away for a surface in the calling
// pack, which is spawned in the step that registers it — codegen knows which case it is, and a caller here doesn't.
//
// The handle comes from the shell's registry, the app's one list of running surfaces: a surface is registered
// under its ref in the frontend `@apackdev/state` system. Nothing here keeps its own.
import { getCurrentScope, onScopeDispose, shallowReadonly, shallowRef, type Ref } from 'vue'
import { boundFeHost } from '../runtime/fe-host.ts'
import { surfaceActorIfRunning } from './actor-system.ts'

/** Whether a surface is running at `ref` in this window. What a reader hands back is `undefined` until it is. */
export function surfaceIsRunning(ref: string): boolean {
  return surfaceActorIfRunning(ref) !== undefined
}

/**
 * A value from the state of the surface at `ref`, following it until the calling scope is disposed. So it runs in a
 * component's setup or an effect scope, never inside a `computed` — `readUntypedSurfaceState` is the one-shot read.
 *
 * The snapshot's type is the caller's to name, since only it knows which surface the ref belongs to:
 *
 * ```ts
 * useUntypedSurfaceState(ref('notes'), (s: SnapshotFrom<NotesState>) => s.context.notes)
 * ```
 *
 * It follows the surface *arriving* as well as changing: a read made while another pack's frontend is still loading
 * starts `undefined` and fills in once that pack registers its surfaces, and one whose pack reloads follows the new
 * actor. Both are the shell's doing, so the shell's own snapshot is what says to look again.
 */
export function useUntypedSurfaceState<TSnapshot, TSelected>(
  ref: string,
  selector: (snapshot: TSnapshot) => TSelected,
): Readonly<Ref<TSelected | undefined>> {
  if (!getCurrentScope()) {
    throw new Error(`useUntypedSurfaceState("${ref}") runs in a component's setup or an effect scope: its ref follows the surface until that scope is disposed. Outside one, read it once with readUntypedSurfaceState()`)
  }
  // A `shallowRef` triggers only when the value it is given actually changed, so a component reading one field
  // isn't re-rendered because another moved. Comparing here first would only repeat that.
  const selected = shallowRef<TSelected | undefined>(undefined)
  let followed: ReturnType<typeof surfaceActorIfRunning>
  let subscription: { unsubscribe(): void } | undefined

  /** Follow whatever is running at `ref` now; cheap and idempotent while that is the same actor */
  const follow = () => {
    const actor = surfaceActorIfRunning(ref)
    if (actor === followed) return
    subscription?.unsubscribe()
    followed = actor
    if (!actor) {
      subscription = undefined
      selected.value = undefined
      return
    }
    selected.value = selector(actor.getSnapshot() as TSnapshot)
    subscription = actor.subscribe((snapshot: unknown) => {
      selected.value = selector(snapshot as TSnapshot)
    })
  }

  follow()
  const shell = boundFeHost().application.subscribe(() => follow())
  onScopeDispose(() => {
    shell.unsubscribe()
    subscription?.unsubscribe()
  })
  return shallowReadonly(selected) as Readonly<Ref<TSelected | undefined>>
}

/**
 * The same read, once, for code outside a reactive scope — a machine's action, an event handler. It takes the value
 * as it is now and never follows it, so a surface that isn't running yet reads as `undefined` rather than later.
 */
export function readUntypedSurfaceState<TSnapshot, TSelected>(
  ref: string,
  selector: (snapshot: TSnapshot) => TSelected,
): TSelected | undefined {
  const actor = surfaceActorIfRunning(ref)
  return actor ? selector(actor.getSnapshot() as TSnapshot) : undefined
}
