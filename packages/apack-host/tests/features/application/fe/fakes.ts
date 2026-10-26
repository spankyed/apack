// The shell's I/O, faked for its specs: a client to no API that the test plays the connection of, pack frontends the
// test loads, storage kept in memory, and records of what the shell reported to the user
import { vi } from 'vitest';
import { setup } from 'xstate';
import type { FeatureRef } from '@apackdev/sdk/ids';
import type { SurfaceCatalogEntry } from '../../../../src/packs/catalog.ts';
import type { SurfaceFrontendBinding } from '../../../../src/fe/pack-store.ts';
import type { Message } from '@apackdev/sdk/events';
import type { Surface, ShellPanelSizes } from '@apackdev/sdk/fe';
import type { LoadedPackEntry, ShellClient, ShellConnection, ShellFailure, ShellOptions } from '../../../../src/fe/index.ts';

/** A surface with an empty machine */
export function surface(id: string): Surface {
  return { id, label: id, icon: 'Zap', state: setup({}).createMachine({}), canvas: {} } as unknown as Surface;
}

export function fakeClient() {
  let connection: ShellConnection | undefined;
  /** The connection the shell subscribed with; throws when it hasn't subscribed (or unsubscribed) */
  const current = (): ShellConnection => {
    if (!connection) throw new Error('The shell has no subscription to the fake client');
    return connection;
  };
  const mocks = {
    entityExists: vi.fn<ShellClient['entityExists']>(() => Promise.resolve(true)),
    send: vi.fn<(message: Message) => void>(),
    packClientReady: vi.fn<(packId: string, registrationId: string) => Promise<void>>(() => Promise.resolve()),
    // A test gives only the fields of a loaded pack the shell reads
    loadedPacks: vi.fn<() => Promise<Array<Partial<LoadedPackEntry> & { id: string }>>>(() => Promise.resolve([])),
    describeConnection: vi.fn<() => Promise<string>>(() => Promise.resolve('')),
    watchView: vi.fn<ShellClient['watchView']>(() => () => {}),
  };
  const client: ShellClient = {
    ...mocks,
    loadedPacks: async () => (await mocks.loadedPacks()).map(pack => ({ registrationId: 'runtime', ...pack })) as LoadedPackEntry[],
    subscribe: (next) => {
      connection = next;
      return () => { if (connection === next) connection = undefined; };
    },
  };
  return {
    client,
    ...mocks,
    /** This window's subscription is established */
    connect: () => current().onConnected(),
    /** The socket dropped */
    dropConnection: () => current().onDisconnected(),
    /** A backend system sent a surface `message` */
    receive: (message: Message) => current().onMessage(message),
    /** The backend failed for good */
    fail: (error: ShellFailure) => current().onFailed(error),
  };
}

/** The shell's options over fakes, starting with `surfaces` registered (the first is the default, unless one is given) */
export function fakeShell(start: { surfaces: Surface[]; defaultSurface?: Surface; designations?: Record<string, FeatureRef> }) {
  const client = fakeClient();
  const packFrontends = {
    load: vi.fn<(pack: { id: string }) => Promise<Surface[] | null>>(() => Promise.resolve(null)),
    unload: vi.fn<(packId: string) => void>(),
  };
  const notify = {
    error: vi.fn<(title: string, detail?: string) => void>(),
    errorPage: vi.fn<(title: string, detail: ShellFailure) => void>(),
  };
  let savedSizes: ShellPanelSizes | undefined;
  const storage = {
    loadPanelSizes: () => savedSizes,
    savePanelSizes: vi.fn((sizes: ShellPanelSizes) => { savedSizes = sizes; }),
  };
  const declarations = new Map<string, SurfaceCatalogEntry>();
  const bindings = new Map<string, SurfaceFrontendBinding>();
  const accept = (value: Surface) => {
    const entry: SurfaceCatalogEntry = { featureRef: value.id as FeatureRef, packId: value.id.split('/')[0]!, origin: 'native', enabled: true,
      declaration: { label: value.label, state: 'native/state.ts',
        ...(value.id === (start.defaultSurface ?? start.surfaces[0])?.id && { default: true }) } };
    if (!declarations.has(value.id)) declarations.set(value.id, entry);
    bindings.set(value.id, { packId: entry.packId, declaration: declarations.get(value.id)!.declaration, opens: declarations.get(value.id)!.opens, binding: value });
  };
  start.surfaces.forEach(accept);
  const catalogListeners = new Set<() => void>();
  const catalog = { status: vi.fn<() => 'loading' | 'ready'>(() => 'loading'), surfaces: () => [...declarations.values()],
    subscribe(listener: () => void) { catalogListeners.add(listener); return () => { catalogListeners.delete(listener); }; } };
  const pending = new Set<string>();
  const ready = () => { if (!pending.size) { catalog.status.mockReturnValue('ready'); for (const listener of catalogListeners) listener(); } };
  const options: ShellOptions = {
    packs: { getRegisteredSurfaces: () => start.surfaces, surfaceBindings: () => bindings, designation: role => start.designations?.[role] },
    catalog,
    client: { ...client.client, async loadedPacks() {
      const packs = await client.client.loadedPacks();
      pending.clear(); for (const pack of packs) if (pack.feEntry) pending.add(pack.id);
      ready(); return packs;
    } },
    packFrontends: {
      async load(pack) {
        try { const surfaces = await packFrontends.load(pack); surfaces?.forEach(accept); return surfaces; }
        finally { pending.delete(pack.id); ready(); }
      },
      unload(id) { packFrontends.unload(id); for (const [ref, binding] of bindings) if (binding.packId === id) bindings.delete(ref); },
    },
    storage,
    notify,
  };
  return { options, client, packFrontends, notify, storage, declarations, bindings, catalog, catalogListeners, acceptSurface: accept,
    publishCatalog() { for (const listener of catalogListeners) listener(); } };
}

/** Lets the loader's read of the loaded packs and its frontend loads settle */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
