import { untypedCreate } from '@apackdev/sdk/ears';
// The pack's frontend on the app's own shell (startShell): opening its surface by name, the shell's state as useShell()
// reads it, and the surface reaching its system and hearing back over the harness's bus, with no app launched.
import { effectScope } from 'vue';
import { expect, it } from 'vitest';
import { startApp, startShell } from '@apackdev/testing/harness';
import { openEntity, useShell } from '@apackdev/sdk/fe';
import { openSurface } from '#generated/fe.ts';
import { sendToSurface } from '#generated/events.ts';
import memosState from '../../../../src/features/memos/fe/state.ts';
import notesState from '../../../../src/features/notes/fe/state.ts';

const memo = { id: 'memo-1', shortCode: 'MEM-1' as const, text: 'handed over on opening', createdAt: 1 };

it('opens its surface by name, hands it the events, and the shell reads it as open', async () => {
  const shell = await startShell({ surfaces: { notes: { state: notesState }, memos: { state: memosState } } });
  const scope = effectScope();
  const state = scope.run(() => useShell())!;
  expect(shell.opened()).toBe('e2e-fixture/notes');

  openSurface('memos', { type: 'MEMOS_CONNECTED', memos: [memo] });

  expect(shell.opened()).toBe('e2e-fixture/memos');
  expect(state.activeSurface.value.id).toBe('e2e-fixture/memos');
  expect(shell.surface('memos').getSnapshot().context.memos).toEqual([memo]);
  expect(shell.notices).toEqual([]);
  scope.stop();
});

// `sendToSurface` is the renderer's half: it reaches this window's actor directly, without opening the surface.
// What it may carry is the inbox the surface's `Contract` declares (`fe/types.ts`) — this is the only place an
// external pack's declared inbox is exercised, the app's own packs being built by the same codegen.
it('sends a declared event to a surface in this window without opening it', async () => {
  const shell = await startShell({ surfaces: { notes: { state: notesState }, memos: { state: memosState } } });
  expect(shell.opened()).toBe('e2e-fixture/notes');

  sendToSurface('memos', { type: 'MEMO.HIGHLIGHT', memoId: memo.id });

  expect(shell.surface('memos').getSnapshot().context.highlighted).toBe(memo.id);
  // still where it was: this send delivers, it doesn't navigate
  expect(shell.opened()).toBe('e2e-fixture/notes');
  expect(shell.notices).toEqual([]);
});

it('tells the user about a surface no pack provides, once loading has settled', async () => {
  const shell = await startShell({ surfaces: { memos: { state: memosState } } });

  openSurface('default-setup/logs');

  expect(shell.opened()).toBe('e2e-fixture/memos');
  // One function writes every refusal the shell makes, so a pack sees the same sentence whichever branch refused
  expect(shell.notices).toEqual([{ title: "Couldn't open default-setup/logs", detail: 'No surface is declared at "default-setup/logs".' }]);
});

it("reaches its system and hears back over the harness's bus", async () => {
  const app = await startApp({ systems: ['memos'] });
  await app.connect();
  const shell = await startShell({ surfaces: { memos: { state: memosState } } });

  shell.surface('memos').send({ type: 'MEMOS.ADD', text: 'added from the surface' });
  await app.settle();

  expect((shell.surface('memos').getSnapshot().context.memos as Array<{ text: string }>).map(m => m.text)).toContain('added from the surface');
});

it('refuses a second frontend host in one test, naming what to do', async () => {
  await startShell({ surfaces: { memos: { state: memosState } } });

  await expect(startShell({ surfaces: { memos: { state: memosState } } })).rejects.toThrow('startShell() binds its own');
});

it('opens an existing entity through compiled destinations and the real shell', async () => {
  const id = untypedCreate('Memo', { text: 'Opened by canonical ID' }).id();
  const shell = await startShell({ surfaces: { notes: { state: notesState }, memos: { state: memosState } } });
  expect(shell.opened()).toBe('e2e-fixture/notes');
  openEntity(id);
  await expect.poll(() => shell.surface('memos').getSnapshot().context.highlighted).toBe(id);
  expect(shell.opened()).toBe('e2e-fixture/memos');
  expect(shell.notices).toEqual([]);
});
