// The port between the app shell and the packs feature: the shell loads a pack's frontend through it, and the
// packs feature implements it (`createPackFrontends`). It lives here, beside the other things a frontend needs
// that aren't a feature's, because a port belongs to neither side — either feature owning it would make the
// other reach into it, which is the one thing a feature's frontend may not do.
import type { Surface } from '@apackdev/sdk/fe';
import type { LoadedPackEntry } from '../packs/layout-types.ts';

/** Loads and unloads external packs' frontends (the renderer imports them from `pack://`) */
export interface ShellPackFrontends {
  /** Loads a pack's frontend: the surfaces it exports, or null for a pack with no frontend code. Throws when it fails */
  load(pack: LoadedPackEntry, signal?: AbortSignal): Promise<Surface[] | null>;
  /** Takes out what a pack's frontend registered */
  unload(packId: string): void;
}
