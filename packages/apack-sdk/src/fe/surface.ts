import type { FeatureRef } from '../ids/refs.ts';
import type { Component } from 'vue';
import type { AnyStateMachine, SnapshotFrom } from 'xstate';
import type { SurfaceHotkeyDefinition } from './hotkeys.ts';

type RouteName = string;
export type RouteComponents = Record<RouteName, Component>;

/** A bound surface assembled by codegen; the host assigns its feature ref at registration. */
export type SurfaceDefinition = Omit<Surface, 'id'>;

/** The audiences a surface's contract may open its inbox to, and what each one means. */
export interface SurfaceInboxAudiences {
  /** What this pack's own features may send it */
  pack?: { type: string };
  /** What a dependent pack may send it: the half that reaches the facade */
  public?: { type: string };
}

/**
 * Constrains the `inbox` half of a surface's `Contract`, so a misspelled audience fails to compile rather than
 * declaring an inbox nobody can reach:
 *
 * ```ts
 * // features/memos/fe/types.ts
 * export type Contract = {
 *   state: MemosContext
 *   inbox: SurfaceInbox<{ public: { type: 'MEMO.OPEN'; memoId: string } }>
 * }
 * ```
 *
 * A feature's own system needs no declaration: what that system sends is already its outgoing union, and codegen
 * adds it. This is for the rest — what another feature's or another pack's frontend sends — which nothing else says.
 *
 * Codegen reads the contract as a *declared type* from the module `apack.json` names at
 * `features[].surface.contract`, and from nowhere else: reading it from `fe/surface.ts` would pull in the machine,
 * whose own imports cycle back through `#generated/events`. Nothing here exists at runtime.
 */
export type SurfaceInbox<T extends SurfaceInboxAudiences> = T;

/**
 * The state a surface's `Contract` publishes — the whole of its context unless the contract narrows it with
 * `Pick<>`. Generated code builds each pack's `PackSurfaceState` with it, and the typed readers in `#generated/fe`
 * hand a selector this rather than an XState snapshot.
 *
 * Reads are public where sends are declared by audience, and the asymmetry is deliberate: a send changes the
 * surface's behaviour, a read does not, and a dependent pack that could read nothing by default would have no way
 * to render what the user has open in someone else's surface.
 */
export type SurfaceStateOf<C> = C extends { state: infer State } ? State : never;

/**
 * What the app's shell hands every surface's machine about the surface itself, each in a delivery naming that
 * surface — so a send its handler makes carries the surface's ref and can be answered:
 *
 * - `SURFACE_STARTED`, once, as soon as the surface's actor is spawned (each time it is, a pack's reload included).
 *   It is where a surface asks for what it starts from: a send made from the machine's own entry runs in no delivery,
 *   carries no sender, and so cannot be answered.
 * - `SURFACE_ACTIVATED` and `SURFACE_DEACTIVATED`, as the surface becomes the one shown and stops being it.
 */
export type SurfaceLifecycleEvent =
  | { type: 'SURFACE_STARTED' }
  | { type: 'SURFACE_ACTIVATED' }
  | { type: 'SURFACE_DEACTIVATED' }

/** A registered surface: its definition, at its ref */
export interface Surface {
  /** The surface's ref, `<packId>/<featureId>` (the host's own under `host`) */
  id: FeatureRef;
  label: string;
  isPinned?: boolean;
  state: AnyStateMachine;
  icon?: Component;
  canvas?: Component | RouteComponents;
  panel?: Component;
  /**
   * Offers this surface's `panel` for surfaces that have none of their own. The app shows it in their place while
   * `isShown` holds of this surface's state, and its menu item (`label`) sends this surface `toggle`. The app asks
   * only through these, never reading the surface's state itself.
   */
  fallbackPanel?: {
    label: string;
    isShown: (snapshot: SnapshotFrom<AnyStateMachine>) => boolean;
    toggle: { type: string };
  };
  chat?: Component;
  hotkeys?: SurfaceHotkeyDefinition[];
  options?: {
    headerClass?: string;
  };
}
