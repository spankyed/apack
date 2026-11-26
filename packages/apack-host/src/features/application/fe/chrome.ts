// Declarative surface chrome (breadcrumbs and context menu) and its pure derivation from a surface's
// current state value.
import type { ContextMenuItem } from '@apackdev/sdk/fe';
import type { BreadcrumbItem } from './trail.ts';

/** Structural shape of a surface's state value (compatible with `@apackdev/state` `Value<S>`). */
export interface SurfaceStateValue {
  readonly at?: string;
  readonly data: unknown;
}

type BreadcrumbSpec<V extends SurfaceStateValue> =
  | BreadcrumbItem
  | readonly BreadcrumbItem[]
  | ((state: V) => BreadcrumbItem | readonly BreadcrumbItem[] | undefined);

type MenuSpec<V extends SurfaceStateValue> =
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

function isReadonlyArray<T>(value: T | readonly T[]): value is readonly T[] {
  return Array.isArray(value);
}

/** Extracts the top-level state name (first `.`-delimited segment) from a state path. */
export function topLevelState(at: string | undefined): string | undefined {
  if (!at) return undefined;
  const dot = at.indexOf('.');
  const first = dot === -1 ? at : at.slice(0, dot);
  return first || undefined;
}

function resolveBreadcrumbs<V extends SurfaceStateValue>(
  spec: BreadcrumbSpec<V> | undefined,
  state: V,
): BreadcrumbItem[] | undefined {
  if (spec === undefined) return undefined;
  const resolved = typeof spec === 'function' ? spec(state) : spec;
  if (resolved === undefined) return undefined;
  return isReadonlyArray(resolved) ? [...resolved] : [resolved];
}

function resolveMenu<V extends SurfaceStateValue>(
  spec: MenuSpec<V> | undefined,
  state: V,
): readonly ContextMenuItem[] {
  if (spec === undefined) return [];
  return typeof spec === 'function' ? spec(state) : spec;
}

function mergeMenuItems(
  rootItems: readonly ContextMenuItem[],
  stateItems: readonly ContextMenuItem[],
): ContextMenuItem[] {
  if (rootItems.length > 0 && stateItems.length > 0) {
    const stateWithSep = stateItems.map((item, index) =>
      index === 0 && !item.separator ? { ...item, separator: true } : item,
    );
    return [...rootItems, ...stateWithSep];
  }
  return [...rootItems, ...stateItems];
}

/** Computes breadcrumbs, merged context menu items, and route target for a surface from its chrome and state. */
export function computeTrail<V extends SurfaceStateValue>(
  chrome: SurfaceChrome<V> | undefined,
  state: V | undefined,
): ComputedTrail {
  if (!state) {
    return { breadcrumbs: [], contextMenu: [], target: undefined };
  }

  const top = topLevelState(state.at);
  if (!chrome) {
    return { breadcrumbs: [], contextMenu: [], target: top };
  }

  const stateChrome = top !== undefined && chrome.states && Object.hasOwn(chrome.states, top)
    ? chrome.states[top]
    : undefined;

  const stateCrumbs = resolveBreadcrumbs(stateChrome?.breadcrumb, state);
  const crumbs = stateCrumbs ?? resolveBreadcrumbs(chrome.breadcrumb, state) ?? [];

  if (chrome.default) {
    if (crumbs.length === 0) {
      crumbs.push(chrome.default);
    } else if (top !== chrome.default.target && crumbs[0]?.target !== chrome.default.target) {
      crumbs.unshift(chrome.default);
    }
  }

  const rootItems = resolveMenu(chrome.menu, state);
  const stateItems = resolveMenu(stateChrome?.menu, state);
  const contextMenu = mergeMenuItems(rootItems, stateItems);

  const target = crumbs[crumbs.length - 1]?.target ?? top;

  return { breadcrumbs: crumbs, contextMenu, target };
}
