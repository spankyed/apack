import type { ContextMenuItem } from './context-menu.ts';

/** One clickable entry in a surface's breadcrumb trail. */
export interface BreadcrumbItem {
  label: string;
  target: string;
  /** What a click on the crumb hands the surface with its target */
  info?: unknown;
}

/** Structural shape of a surface's state value (compatible with `@apackdev/state` `Value<S>`). */
export interface SurfaceStateValue {
  readonly at?: string;
  readonly data: unknown;
}

/** Static or state-derived breadcrumb declaration for a surface or one of its states. */
export type BreadcrumbSpec<V extends SurfaceStateValue> =
  | BreadcrumbItem
  | readonly BreadcrumbItem[]
  | ((state: V) => BreadcrumbItem | readonly BreadcrumbItem[] | undefined);

/** Static or state-derived context menu declaration for a surface or one of its states. */
export type MenuSpec<V extends SurfaceStateValue> =
  | readonly ContextMenuItem[]
  | ((state: V) => readonly ContextMenuItem[]);

/** Breadcrumb and context menu declarations for one top-level state of a surface. */
export interface SurfaceStateChrome<V extends SurfaceStateValue = SurfaceStateValue> {
  readonly breadcrumb?: BreadcrumbSpec<V>;
  readonly menu?: MenuSpec<V>;
}

/**
 * Declarative breadcrumbs and context menu for a surface.
 *
 * - `default` is prepended when the active top-level state differs from `default.target` (and the leading
 *   crumb does not already target `default.target`), and serves as the sole crumb when no other crumbs resolve.
 * - `breadcrumb` provides root-level breadcrumbs when no active state breadcrumb resolves.
 * - `menu` provides root-level context menu items; state-level items follow them with a separator on the
 *   first state item when both lists are non-empty.
 * - `states` maps top-level state names (the first `.`-delimited segment of `state.at`) to per-state chrome.
 */
export interface SurfaceChrome<V extends SurfaceStateValue = SurfaceStateValue> {
  readonly default?: BreadcrumbItem;
  readonly breadcrumb?: BreadcrumbSpec<V>;
  readonly menu?: MenuSpec<V>;
  readonly states?: Readonly<Record<string, SurfaceStateChrome<V>>>;
}

/** Resolved breadcrumbs, context menu items, and canvas route target for a surface's current state. */
export interface ComputedTrail {
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly contextMenu: readonly ContextMenuItem[];
  readonly target: string | undefined;
}
