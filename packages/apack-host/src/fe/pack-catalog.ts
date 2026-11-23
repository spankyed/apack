import { dslCatalogEntries } from '../packs/catalog-dsl.ts';
import { assertEventContracts, eventCatalogEntries } from '../packs/catalog-events.ts';
import { captureData } from '../packs/captured-data.ts';
import { assertCatalogClaims, surfaceCatalogEntries, nativeSurfaceCatalogEntries } from '../packs/catalog-surfaces.ts';
import { stepCatalogEntries } from '../packs/catalog-steps.ts';
import type { PackCatalogFrame, PackCatalogSnapshot } from '../packs/catalog.ts';
import type { NativePackDeclaration, PackCatalogView } from '@apackdev/sdk/framework';
import { referenceCatalogEntries } from '../packs/catalog-references.ts';
import { frontendCatalogEntries } from '../packs/catalog-frontend.ts';
import { artifactCatalogEntries } from '../packs/catalog-artifacts.ts';
import { blockCatalogEntries } from '../packs/catalog-blocks.ts';
import { _nativePackDeclarationProblem, _settingsJsonProblems } from '@apackdev/sdk/framework';
import { errorMessage, isPlainObject } from '@apackdev/sdk/utils/pure';
import { createLogger } from '@apackdev/sdk/logger';
import { isEqual } from '../features/settings/document.ts';

export interface WindowPackCatalogIO {
  timeoutMs?: number;
  subscribe(receive: (frame: PackCatalogFrame) => void, failed: (error: unknown) => void): () => void;
}

const SNAPSHOT_FIELDS = { revision: true, appSettings: true, packs: true, problems: true, native: true,
  sourcePacks: true, appPackSources: true, appPackSourceProblems: true } satisfies Record<keyof PackCatalogSnapshot, true>;

/** Immutable declaration data; the active frontend registry has a separate lifetime. */
export function createWindowPackCatalog(io: WindowPackCatalogIO, native: readonly NativePackDeclaration[] = []) {
  for (const declaration of native) {
    const problem = _nativePackDeclarationProblem(declaration);
    if (problem) throw new Error(`Invalid native declarations: ${problem}`);
  }
  const localSurfaces = nativeSurfaceCatalogEntries(captureData(native));
  const localEvents = eventCatalogEntries({ native: captureData(native), packs: [], sourcePacks: [] });
  let generation = 0;
  let stop: (() => void) | undefined;
  let frame: PackCatalogFrame | undefined;
  let status: 'loading' | 'ready' | 'disconnected' | 'error' | 'disposed' = 'disconnected';
  let problem: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const logger = createLogger('declaration-catalog-window');
  const listeners = new Set<() => void>();
  const tell = () => {
    // New observers wait for the next publication, even if registered by a current observer.
    const notified = [...listeners];
    for (const listener of notified) {
      try { listener(); } catch (error) { logger.error('Catalog listener failed', error); }
    }
  };
  const close = () => {
    generation++;
    clearTimeout(timer); timer = undefined;
    const previous = stop; stop = undefined;
    try { previous?.(); } catch (error) { logger.error('Catalog subscription cleanup failed', error); }
  };

  function receive(value: unknown): void {
    if (_settingsJsonProblems(value).length || !isPlainObject(value) || typeof value.runId !== 'string' || !value.runId
      || Object.keys(value).some(key => key !== 'runId' && key !== 'snapshot')) throw new Error('Invalid declaration catalog frame');
    const snapshot = value.snapshot;
    if (!isPlainObject(snapshot) || Object.keys(snapshot).length !== Object.keys(SNAPSHOT_FIELDS).length
      || Object.keys(snapshot).some(key => !Object.hasOwn(SNAPSHOT_FIELDS, key)) || !Number.isSafeInteger(snapshot.revision) || (snapshot.revision as number) < 0
      || !isPlainObject(snapshot.appSettings)
      || ['packs', 'problems', 'native', 'sourcePacks', 'appPackSources', 'appPackSourceProblems'].some(key => !Array.isArray(snapshot[key]))) {
      throw new Error('Invalid declaration catalog frame');
    }
    const next = captureData(value) as unknown as PackCatalogFrame;
    if (frame && frame.runId !== next.runId) throw new Error('Declaration catalog backend changed within one connection');
    if (frame && next.snapshot.revision < frame.snapshot.revision) return;
    if (frame && next.snapshot.revision === frame.snapshot.revision) {
      if (!isEqual(frame.snapshot, next.snapshot)) throw new Error('Declarations changed without a catalog revision');
      return;
    }
    assertCatalogClaims(next.snapshot);
    assertEventContracts(next.snapshot);
    clearTimeout(timer); timer = undefined;
    frame = next;
    status = 'ready';
    problem = undefined;
    tell();
  }

  const project = (snapshot: PackCatalogSnapshot) => ({ snapshot,
    surfaces: surfaceCatalogEntries(snapshot), references: referenceCatalogEntries(snapshot), frontend: frontendCatalogEntries(snapshot), steps: stepCatalogEntries(snapshot),
    artifacts: artifactCatalogEntries(snapshot), blocks: blockCatalogEntries(snapshot), dsl: dslCatalogEntries(snapshot), events: eventCatalogEntries(snapshot),
  });
  let projected: ReturnType<typeof project> | undefined;
  const projection = () => {
    const snapshot = frame?.snapshot;
    if (!snapshot) return undefined;
    if (projected?.snapshot !== snapshot) projected = project(snapshot);
    return projected;
  };
  const catalog: PackCatalogView = {
    status: () => status, problem: () => problem,
    references: () => projection()?.references ?? [], frontend: () => projection()?.frontend ?? [],
    steps: () => projection()?.steps ?? [],
    artifacts: () => projection()?.artifacts ?? [],
    blocks: () => projection()?.blocks ?? [],
    dsl: () => projection()?.dsl ?? [],
    events: () => status === 'disposed' ? [] : projection()?.events ?? localEvents,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };

  return {
    catalog,
    surfaces: () => status === 'disposed' ? [] : projection()?.surfaces ?? localSurfaces,
    getSnapshot: (): PackCatalogSnapshot | undefined => frame?.snapshot,
    status: () => status,
    problem: () => problem,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect() {
      if (status === 'disposed') throw new Error('Declaration catalog is disposed');
      close();
      frame = undefined;
      projected = undefined;
      status = 'loading';
      problem = undefined;
      const accepted = generation;
      const fail = (error: unknown) => {
        if (accepted !== generation) return;
        close();
        status = 'error';
        problem = errorMessage(error);
        tell();
      };
      try {
        const unsubscribe = io.subscribe(value => {
          if (accepted !== generation) return;
          try { receive(value); } catch (error) { fail(error); }
        }, fail);
        if (accepted === generation) stop = unsubscribe; else unsubscribe();
      } catch (error) { fail(error); }
      if (accepted === generation && status === 'loading') {
        timer = setTimeout(() => fail(new Error('The backend did not provide declaration catalog data')), io.timeoutMs ?? 30_000);
        tell();
      }
    },
    disconnect() { if (status === 'disposed' || status === 'disconnected') return; close(); status = 'disconnected'; tell(); },
    dispose() { if (status === 'disposed') return; close(); status = 'disposed'; frame = undefined; projected = undefined; tell(); listeners.clear(); },
  };
}
