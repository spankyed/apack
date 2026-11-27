// The Packs surface asks the `host/packs` system for what it shows, and tells the shell when a pack's surfaces
// are gone. It doesn't unload the pack's frontend itself: the shell loads a pack's frontend and the shell
// unloads it, so a pack that comes back is loaded once and taken out once.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Surface } from '@apackdev/sdk/fe';
import { createShell, type ShellRuntime } from '../../../../src/fe/index.ts';
import packsMachine, { packsChrome } from '../../../../src/features/packs/fe/machine.ts';
import { fakeShell, surface } from '../../application/fe/fakes.ts';

let app: ShellRuntime;
let shell: ReturnType<typeof fakeShell>;

/** The Packs tab as the renderer registers it: the host's state, with its declarative chrome */
const packsSurface = {
  id: 'host/packs',
  label: 'Packs',
  icon: 'Package',
  state: packsMachine,
  chrome: packsChrome,
  canvas: {},
} as unknown as Surface;

beforeEach(() => {
  shell = fakeShell({ surfaces: [surface('notes'), packsSurface] });
  app = createShell(shell.options, { ownsLastActiveSurface: false }).start();
  shell.client.connect();
  shell.client.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded: true, surfaceVisibility: {} } });
});

afterEach(() => { app.stop(); });

/** What the `host/packs` system sent its surface */
const receive = (event: Record<string, unknown>) => shell.client.receive({ to: 'host/packs', event: event as never });
const packsTab = () => app.surface('host/packs')!;
const packsData = () => (app.system.read({ ref: 'host/packs' }) as { data: Record<string, unknown> }).data;

describe('the Packs surface', () => {
  it("has the shell unload a deactivated pack's frontend, rather than unloading it itself", () => {
    receive({ type: 'PACK_DEACTIVATED', packId: 'memo-pack' });

    expect(shell.packFrontends.unload).toHaveBeenCalledWith('memo-pack');
  });

  it('shows the packs the system lists', () => {
    receive({ type: 'PACKS_LIST', packs: [{ id: 'memo-pack', name: 'Memos' }], appPackSources: [], appPackSourceProblems: [] });

    expect(packsData().packs).toEqual([{ id: 'memo-pack', name: 'Memos' }]);
    expect(packsData().appPackSources).toEqual([]);
  });
});

it('keeps app default offers separate from installed rows and forwards explicit selection intent', () => {
  const source = { id: 'default-pack', name: 'Default', version: '1.0.0', sourceRevision: 'a'.repeat(64) };
  receive({ type: 'PACKS_LIST', packs: [], appPackSources: [source], appPackSourceProblems: [] });
  expect(packsData().packs).toEqual([]);
  expect(packsData().appPackSources).toEqual([source]);
  packsTab().send({ type: 'UI.RESTORE', packId: source.id, sourceRevision: source.sourceRevision });
  expect(shell.client.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'host/packs', event: {
    type: 'RESTORE_PACK', packId: source.id, sourceRevision: source.sourceRevision,
  } }));
  packsTab().send({ type: 'UI.REPLACE', packId: source.id, packSlug: '/fork', sourceKind: 'local' });
  expect(shell.client.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'host/packs', event: {
    type: 'REPLACE_PACK', packId: source.id, packSlug: '/fork', sourceKind: 'local',
  } }));
});

it('forwards selected app revisions and keeps a failed update visible through list refresh', () => {
  packsTab().send({ type: 'UI.UPDATE_APP', packId: 'default-pack', sourceRevision: 'a'.repeat(64) });
  expect(shell.client.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'host/packs', event: {
    type: 'UPDATE_APP_PACK', packId: 'default-pack', sourceRevision: 'a'.repeat(64),
  } }));
  receive({ type: 'PACK_UPDATE_FAILED', packId: 'default-pack', error: 'Source changed; refresh before updating' });
  receive({ type: 'PACKS_LIST', packs: [], appPackSources: [], appPackSourceProblems: [] });
  expect(packsData().error).toBe('Source changed; refresh before updating');
  expect(packsData().updatingPackId).toBeNull();
});
