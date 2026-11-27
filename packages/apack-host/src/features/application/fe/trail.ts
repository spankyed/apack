// The breadcrumbs and context menu of the surface open: derived from its `@apackdev/state` value and `chrome` table
// each time its state changes.
import type { BreadcrumbItem, ContextMenuItem, SurfaceChrome } from '@apackdev/sdk/fe';
import { splitRef } from '@apackdev/sdk/ids';
import { computeTrail } from './chrome.ts';

const capitalizeFirstLetter = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type { BreadcrumbItem };

export type UpdateData = {
  crumbs: BreadcrumbItem[];
  target?: string;
  menuItems: ContextMenuItem[];
};

export interface TrailSurfaceState {
  readonly id: string;
  readonly at?: string;
  readonly data: unknown;
  readonly chrome?: SurfaceChrome<never>;
}

export function computeCrumbs(surface: TrailSurfaceState): UpdateData {
  const at = surface.at && surface.at !== '' ? surface.at : undefined;
  const computed = computeTrail(surface.chrome as SurfaceChrome | undefined, { ...(at !== undefined ? { at } : {}), data: surface.data });
  const fallbackLabel = capitalizeFirstLetter(splitRef(surface.id)?.featureId ?? surface.id);
  const crumbs = computed.breadcrumbs.length > 0
    ? [...computed.breadcrumbs]
    : (fallbackLabel ? [{ label: fallbackLabel, target: computed.target ?? '' }] : []);
  const target = computed.target ?? crumbs[crumbs.length - 1]?.target;
  return { crumbs, target, menuItems: [...computed.contextMenu] };
}

export interface SurfaceTrailer {
  follow(id: string): void;
  onSystemChange(changed: readonly string[]): void;
  readTarget(id: string): string | undefined;
}

/** Tracks the active surface's breadcrumbs and context menu across `@apackdev/state` system commits. */
export function createSurfaceTrailer(
  readSurface: (id: string) => TrailSurfaceState | undefined,
  onUpdate: (data: UpdateData) => void,
): SurfaceTrailer {
  let trackedId: string | undefined;

  const emitFor = (id: string): void => {
    const surface = readSurface(id);
    if (!surface) return;
    onUpdate(computeCrumbs(surface));
  };

  return {
    follow(id: string): void {
      trackedId = id;
      emitFor(id);
    },
    onSystemChange(changed: readonly string[]): void {
      if (!trackedId || !changed.includes(trackedId)) return;
      emitFor(trackedId);
    },
    readTarget(id: string): string | undefined {
      const surface = readSurface(id);
      return surface ? (computeCrumbs(surface).target ?? '') : undefined;
    },
  };
}
