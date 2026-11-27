// Declarative surface chrome (breadcrumbs and context menu) and its pure derivation from a surface's
// current state value.
import type {
  BreadcrumbItem,
  ComputedTrail,
  ContextMenuItem,
  SurfaceChrome,
  SurfaceStateChrome,
  SurfaceStateValue,
} from '@apackdev/sdk/fe';

export type {
  BreadcrumbItem,
  ComputedTrail,
  SurfaceChrome,
  SurfaceStateChrome,
  SurfaceStateValue,
};

type BreadcrumbSpec<V extends SurfaceStateValue> =
  | BreadcrumbItem
  | readonly BreadcrumbItem[]
  | ((state: V) => BreadcrumbItem | readonly BreadcrumbItem[] | undefined);

type MenuSpec<V extends SurfaceStateValue> =
  | readonly ContextMenuItem[]
  | ((state: V) => readonly ContextMenuItem[]);

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
