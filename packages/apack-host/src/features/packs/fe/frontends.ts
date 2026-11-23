// External packs' frontends: which URL a pack's files are at, what counts as a registration one exports, and what
// unloading takes back. The two things only a window can do — import a module and add a stylesheet — arrive as
// `PackFrontendIO`, so the rules hold wherever this runs and the browser's part stays the renderer's.
import type { PackFERegistration, Surface } from '@apackdev/sdk/fe';
import { captureFrontendBindings } from '../../../fe/binding-snapshot.ts';
import { frontendBindingProblem } from '../../../fe/declaration-binding.ts';
import { _packDeclarationProblem, _settingsJsonProblems } from '@apackdev/sdk/framework';
import type { LoadedPackEntry } from '../../../packs/layout.ts';
import type { FePackRegistry, FrontendSettingsBinding, PreparedFrontend } from '../../../fe/pack-store.ts';
import type { ShellPackFrontends } from '../../../fe/pack-frontends.ts';

/** One attempt owns its prepared stylesheet; another attempt cannot dispose it. */
export interface PackFrontendStyle {
  ready: Promise<void>;
  /** Applies loaded styles; the previous accepted owner remains until its own disposal. */
  commit(): void;
  dispose(): void;
}

export interface PackFrontendStyles {
  /** Fetch without applying; readiness and cancellation belong to this lease. */
  prepare(packId: string, href: string): PackFrontendStyle;
  /** Explicit pack unload disposes accepted and pending styles. */
  remove(packId: string): void;
}

/**
 * A pack's frontend served from its source on this disk, by pack id. A dev server fills it (the renderer's
 * `virtual:dev-pack-frontends`); a built app's is empty.
 *
 * It is preferred over `pack://` when the pack is in it, because its modules are in the dev server's own
 * graph: that is what lets a `.vue` edit patch the component rather than reload the whole page. It is keyed
 * by pack id and asks nothing else about the pack — a pack is in it because its source is here.
 */
export type DevPackFrontends = Record<string, () => Promise<{ default?: unknown }>>;

/** What loading a pack's frontend needs from the window it loads into */
export interface PackFrontendIO {
  /** Imports a module by URL, as the window's dynamic `import()` does */
  importModule(url: string): Promise<{ default?: unknown }>;
  styles: PackFrontendStyles;
  /** The packs this window serves from source, preferred over `pack://`; none in a built app */
  devFrontends?: DevPackFrontends;
  /** Supplies authority for the accepted backend declarations/build, never a claimed sender label. */
  settingsForPack?: (pack: LoadedPackEntry) => Promise<FrontendSettingsBinding>;
}

/**
 * What a default export has to declare one of to count as a registration. Tied to the type, so a renamed field is
 * a build failure rather than a warning that stops firing.
 */
const REGISTRATION_KEYS = [
  'features', 'settingsForms', 'steps', 'artifacts', 'blocks', 'textEditor', 'appExtensions',
] as const satisfies readonly (keyof PackFERegistration)[];

/** A revision belongs in the base URL so relative imports retain it too. */
function packFileUrl(packBaseUrl: string, file: string): string {
  return `${packBaseUrl}/${file}`;
}

/**
 * Imports a pack's FE entry: its registration, or null when it exports none. Throws when the import fails.
 *
 * `source` is a loader for the pack's own sources when this window serves them, in which case `url` names
 * nothing that is fetched and only labels the failure.
 */
export async function loadPackFEEntry(
  io: PackFrontendIO,
  entry: string,
  packBaseUrl: string,
  source?: () => Promise<{ default?: unknown }>,
): Promise<PackFERegistration | null> {
  const url = source ? `${packBaseUrl} (from source)` : packFileUrl(packBaseUrl, entry);
  let mod: { default?: unknown };
  try {
    mod = source ? await source() : await io.importModule(url);
  } catch (err) {
    // The pack:// URL names the pack; the E2E fixture matches on it
    console.error(`[pack-loader] Failed to load FE entry ${url}:`, err);
    throw err;
  }
  const registration = mod.default;
  if (!registration || typeof registration !== 'object') {
    console.warn(`[pack-loader] FE entry ${url} registers nothing: ${registration === undefined
      ? 'it has no default export — export the registration as default'
      : 'its default export is not a registration'}.`);
    return null;
  }
  // A default export declaring registration fields, even empty ones, is deliberate: the generated entry of a pack
  // without FE extensions is { features: {} }
  if (!REGISTRATION_KEYS.some((key) => key in registration)) {
    console.warn(`[pack-loader] FE entry ${url} registers nothing (no ${REGISTRATION_KEYS.join('/')}): its default export declares none of them.`);
  }
  return registration as PackFERegistration;
}

/**
 * The shell's pack frontends over one window: `load` adds a pack's styles and imports its entry, registering what it
 * contributes and answering with the surfaces it added (null for a pack with no frontend code, whose systems the bus
 * has told already); `unload` undoes both, for a pack deactivated and for a load that finished after it was.
 */
export function createPackFrontends(io: PackFrontendIO, packs: FePackRegistry): ShellPackFrontends {
  const attempts = new Map<string, object>();
  const acceptedStyles = new Map<string, PackFrontendStyle>();
  return {
    async load(input: LoadedPackEntry, signal?: AbortSignal): Promise<Surface[] | null> {
      const pack = { ...input };
      const attempt = {};
      let style: PackFrontendStyle | undefined;
      let prepared: PreparedFrontend | undefined;
      attempts.set(pack.id, attempt);
      const checkCurrent = () => {
        if (signal?.aborted || attempts.get(pack.id) !== attempt) {
          throw new Error(`Pack "${pack.id}" frontend load was cancelled`);
        }
      };
      const cancel = () => {
        if (attempts.get(pack.id) === attempt) {
          attempts.delete(pack.id);
        }
        prepared?.dispose();
        style?.dispose();
      };
      using listener = new DisposableStack();
      signal?.addEventListener('abort', cancel, { once: true });
      listener.defer(() => signal?.removeEventListener('abort', cancel));
      using unwind = new DisposableStack();
      unwind.defer(cancel);
      checkCurrent();
      if (pack.manifest) {
        if (_settingsJsonProblems(pack.manifest).length) throw new Error(`Pack "${pack.id}" declarations must contain JSON data properties`);
        pack.manifest = structuredClone(pack.manifest);
      }
      // Served from source, the pack's styles come through its own module graph with the rest of it
      const source = io.devFrontends?.[pack.id];
      const fromSource = !!source || !!pack.developmentBaseUrl;
      if (!fromSource && (pack.feEntry || pack.feStyles) && !/^[a-f0-9]{64}$/.test(pack.buildRevision ?? '')) {
        throw new Error(`Pack "${pack.id}" frontend has no accepted build identity`);
      }
      const packBaseUrl = pack.developmentBaseUrl ?? `pack://${pack.id}/builds/${pack.buildRevision}`;
      const loadStyles = async () => {
        if (pack.feStyles && !fromSource) {
          style = io.styles.prepare(pack.id, packFileUrl(packBaseUrl, pack.feStyles));
          await style.ready;
        }
      };
      const commitStyles = () => {
        style?.commit();
        const previous = acceptedStyles.get(pack.id);
        if (style) acceptedStyles.set(pack.id, style);
        else acceptedStyles.delete(pack.id);
        previous?.dispose();
      };
      // A pack served from source has a frontend whatever its built manifest says, since the map holds only
      // packs whose codegen wrote one
      if (!pack.feEntry && !source) {
        await loadStyles();
        checkCurrent();
        if (packs.hasPackFE(pack.id)) {
          prepared = packs.prepareUnregisterPackFE(pack.id);
          prepared.commit(() => { checkCurrent(); commitStyles(); });
        } else commitStyles();
        unwind.move();
        return null;
      }

      if (!pack.manifest || pack.manifest.id !== pack.id) throw new Error(`Pack "${pack.id}" frontend has no matching accepted declarations`);
      const entry = await loadPackFEEntry(io, pack.feEntry ?? '', packBaseUrl, source);
      checkCurrent();
      if (!entry) throw new Error(`Pack "${pack.id}" has no frontend registration`);
      const registration = captureFrontendBindings(entry, pack.manifest);
      const problem = _packDeclarationProblem(pack, registration) ?? frontendBindingProblem(pack.manifest, registration);
      if (problem) throw new Error(problem);
      if (registration.bindSettings && !io.settingsForPack) throw new Error(`Pack "${pack.id}" frontend requires host-bound settings access`);
      await loadStyles();
      checkCurrent();
      using pendingSettings = new DisposableStack();
      const settings = registration.bindSettings ? await io.settingsForPack!(pack) : undefined;
      if (settings) pendingSettings.defer(() => settings.dispose());
      checkCurrent();
      // The prepared registry owns provisional authority; publication and CSS share one host commit.
      prepared = packs.preparePackFE({ kind: 'loaded', pack }, registration, settings, packs.hasPackFE(pack.id));
      pendingSettings.move();
      checkCurrent();
      const surfaces = prepared.commit(() => { checkCurrent(); commitStyles(); });
      unwind.move();
      return surfaces;
    },

    unload(packId: string): void {
      attempts.delete(packId);
      try { packs.unregisterPackFE(packId); }
      finally { acceptedStyles.delete(packId); io.styles.remove(packId); }
    },
  };
}
