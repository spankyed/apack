/** A component module, loaded on demand unless explicitly eager; discovery never executes it. */
export type ComponentTarget = string | { entry: string; load?: 'eager' };

/** Surface data known before its machine, views or predicates execute. */
export interface SurfaceDeclaration {
  label: string;
  state: string;
  icon?: string | { entry: string; load?: 'eager' };
  canvas?: ComponentTarget | { routes: Record<string, ComponentTarget> };
  panel?: ComponentTarget;
  chat?: ComponentTarget;
  isPinned?: boolean;
  hotkeys?: readonly { action: string; global?: boolean }[];
  options?: { headerClass?: string };
  fallbackPanel?: { label: string; toggle: { type: string }; isShown: string };
  contract?: string;
  default?: boolean;
  defaultVisible?: boolean;
}

/** @internal File/export targets named by a surface, for validation and source freshness. */
export function _surfaceTargets(surface: SurfaceDeclaration): [string, string][] {
  const component = (field: string, target: ComponentTarget | undefined): [string, string][] =>
    target === undefined ? [] : [[field, typeof target === 'string' ? target : target.entry]];
  const canvas = surface.canvas;
  return [
    ['state', surface.state],
    ...component('icon', typeof surface.icon === 'object' ? surface.icon : undefined),
    ...(canvas && typeof canvas === 'object' && 'routes' in canvas
      ? Object.entries(canvas.routes).flatMap(([route, target]) => component(`canvas.routes.${route}`, target))
      : component('canvas', canvas)),
    ...component('panel', surface.panel), ...component('chat', surface.chat),
    ...(surface.fallbackPanel ? [['fallbackPanel.isShown', surface.fallbackPanel.isShown] as [string, string]] : []),
  ];
}


/** @internal Check compiled destination data without importing contracts or machines. */
export function _entityDestinationsProblem(destinations: Readonly<Record<string, string>>,
  features: Readonly<Record<string, { readonly surface?: unknown }>> | undefined, entities?: ReadonlySet<string>): string | undefined {
  for (const [entity, feature] of Object.entries(destinations)) {
    if (!Object.hasOwn(features ?? {}, feature) || !features![feature].surface) {
      return `Entity destination "${entity}" names feature "${feature}" without a declared surface`;
    }
    if (entities && !entities.has(entity)) return `Entity destination "${entity}" names an unknown entity`;
  }
}
