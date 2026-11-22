// The database surface's backup flow: an export or import is in progress from the ask until the system answers it,
// and how it ended is kept for the Backup & Restore view to report.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

/** The asks the machine has made, in order: what each was, what it carried, and the spec's way to end it */
const asks = vi.hoisted(() => [] as Array<{ type: string; input: Record<string, unknown>; stopped: boolean; settle(outcome: unknown): void }>);
vi.mock('#generated/events.ts', async () => {
  const { fromPromise } = await import('xstate');
  return {
    fromAsk: (_to: string, type: string) => fromPromise(({ input, signal }) => new Promise((resolve) => {
      const ask = { type, input: input as Record<string, unknown>, stopped: false, settle: resolve };
      signal.addEventListener('abort', () => { ask.stopped = true; });
      asks.push(ask);
    })),
  };
});
// The schema is not these cases' subject: a view that is never delivered
vi.mock('#generated/fe.ts', async () => {
  const { fromCallback } = await import('xstate');
  return { fromView: () => fromCallback(() => {}) };
});

const { default: databaseState, isRunningCode } = await import('#features/database/fe/state.ts');

/** The nth ask of `type` the machine made */
const asked = (type: string, nth = 0) => {
  const ask = asks.filter((made) => made.type === type)[nth];
  if (!ask) throw new Error(`no ${type} #${nth} was asked`);
  return ask;
};

/** Ends an ask as its system would, unless the machine gave it up, and waits for the machine to have heard */
async function end(ask: (typeof asks)[number], outcome: unknown) {
  // An ask that was stopped is never answered: its answer, when it comes, is nobody's
  if (!ask.stopped) ask.settle(outcome);
  await new Promise((resolve) => setTimeout(resolve, 0));
}
const answer = (ask: (typeof asks)[number], value: unknown) => end(ask, { ok: true, value });
const fail = (ask: (typeof asks)[number], failure: { kind: string; message: string; [key: string]: unknown }) => end(ask, { ok: false, failure });

function backupView() {
  const actor = createActor(databaseState).start();
  actor.send({ type: 'VIEW_BACKUP' });
  return actor;
}

const backup = (actor: ReturnType<typeof backupView>) => {
  const snapshot = actor.getSnapshot();
  return { exporting: snapshot.context.making.export, importing: snapshot.context.making.import, backupResult: snapshot.context.backupResult };
};

beforeEach(() => {
  asks.length = 0;
});

it('retains the import result instructions for the backup view', async () => {
  const actor = backupView();
  const message = 'Import successful. Please restart the brain manually.';
  actor.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1' });
  await answer(asked('IMPORT_DATABASE'), { message });
  expect(backup(actor).backupResult).toEqual({ operation: 'import', error: undefined, message });
  actor.stop();
});

// The answer to the asker's own import or reset, and the notification every window hears when any one of them
// replaced the data
type Console = ReturnType<typeof backupView>;
it.each([
  ['IMPORT_DATABASE answered', async (actor: Console) => {
    actor.send({ type: 'VIEW_BACKUP' });
    actor.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1' });
    await answer(asked('IMPORT_DATABASE'), { message: 'Completed' });
  }],
  ['RESET_DATABASE answered', async (actor: Console) => {
    actor.send({ type: 'DATABASE.RESET' });
    await answer(asked('RESET_DATABASE'), { message: 'Completed' });
  }],
  ['DATABASE_REPLACED', async (actor: Console) => { actor.send({ type: 'DATABASE_REPLACED' }); }],
] as const)(
  '%s discards old database results and late replies without restarting the window', async (_, replace) => {
    const actor = createActor(databaseState).start();
    actor.send({ type: 'QUERY.UPDATE', code: 'return "keep this editor"' });
    actor.send({ type: 'QUERY.EXECUTE', code: 'return "old rows"' });
    await answer(asked('EXECUTE_QUERY'), { result: 'old rows', executionTime: 1 });
    expect(actor.getSnapshot().context.queryResult).toBe('old rows');
    actor.send({ type: 'QUERY.EXECUTE', code: 'return "late rows"' });
    const abandoned = asked('EXECUTE_QUERY', 1);
    await replace(actor);
    expect(actor.getSnapshot().context).toMatchObject({ currentQuery: 'return "keep this editor"', queryResult: null });
    expect(isRunningCode(actor.getSnapshot().context.making), 'the query under way was given up').toBe(false);
    await answer(abandoned, { result: 'late rows', executionTime: 2 });
    expect(actor.getSnapshot().context.queryResult).toBeNull();
    actor.stop();
  },
);

it('keeps mutable run history state separate between windows', () => {
  const first = createActor(databaseState).start();
  const second = createActor(databaseState).start();
  first.getSnapshot().context.expandedNodes.add('row-from-first-window');
  expect(second.getSnapshot().context.expandedNodes.size).toBe(0);
  expect(first.getSnapshot().context.nodeDetails).not.toBe(second.getSnapshot().context.nodeDetails);
  first.stop(); second.stop();
});

it('keeps the current database results when import is refused', async () => {
  const actor = createActor(databaseState).start();
  actor.send({ type: 'QUERY.EXECUTE', code: 'return "current rows"' });
  await answer(asked('EXECUTE_QUERY'), { result: 'current rows', executionTime: 1 });
  actor.send({ type: 'VIEW_BACKUP' });
  actor.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1' });
  await fail(asked('IMPORT_DATABASE'), { kind: 'failed', message: 'Invalid settings' });
  expect(actor.getSnapshot().context.queryResult).toBe('current rows');
  expect(backup(actor).backupResult?.error).toBe('Invalid settings');
  actor.stop();
});

it('exports until the system answers', async () => {
  const actor = backupView();

  actor.send({ type: 'BACKUP.EXPORT', path: '/backups', databases: ['lmdb'] });
  expect(backup(actor)).toEqual({ exporting: true, importing: false, backupResult: null });

  expect(asked('EXPORT_DATABASE').input).toEqual({ path: '/backups', name: undefined, databases: ['lmdb'] });
  await answer(asked('EXPORT_DATABASE'), { path: '/backups/backup-1' });
  expect(backup(actor)).toEqual({ exporting: false, importing: false, backupResult: { operation: 'export', error: undefined } });
});

it('keeps an import failure, also after leaving the backup view', async () => {
  const actor = backupView();

  actor.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1' });
  expect(backup(actor).importing).toBe(true);
  actor.send({ type: 'BACK_TO_EXPLORER' });

  await fail(asked('IMPORT_DATABASE'), { kind: 'failed', message: 'no manifest' });
  expect(backup(actor)).toEqual({ exporting: false, importing: false, backupResult: { operation: 'import', error: 'no manifest' } });
});

it("keeps the stores a newer apack's backup holds, so the view can ask, and imports without them when told to", async () => {
  const actor = backupView();

  actor.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1' });
  await fail(asked('IMPORT_DATABASE'), { kind: 'unknown-databases', message: 'a newer apack made it', unknownDatabases: ['searchIndex'] });
  expect(backup(actor)).toEqual({
    exporting: false,
    importing: false,
    backupResult: { operation: 'import', error: 'a newer apack made it', unknownDatabases: ['searchIndex'] },
  });

  // What the view sends once the user has said to import it anyway
  actor.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1', skipUnknownDatabases: true });
  expect(asked('IMPORT_DATABASE', 1).input).toEqual({ path: '/backups/backup-1', skipUnknownDatabases: true });
});

// The Database settings' "Reset database" sends DATABASE.RESET to the surface, whichever view it has open
it.each([
  ['the explorer', () => createActor(databaseState).start()],
  ['the backup view', backupView],
])('asks the system to reset the database from %s', (_, open) => {
  const actor = open();

  actor.send({ type: 'DATABASE.RESET' });

  expect(asked('RESET_DATABASE').input).toEqual({});
});

// What the schema view delivers is what the panel shows, and a replacement leaves it to the view
it('holds what the schema view last delivered through a replacement', () => {
  const actor = createActor(databaseState).start();
  const schema = { entities: [{ type: 'Note' }], attributes: [], relations: [] };
  actor.send({ type: 'SCHEMA.READ', schema } as never);
  expect(actor.getSnapshot().context.schema).toEqual(schema);
  actor.send({ type: 'DATABASE_REPLACED' });
  expect(actor.getSnapshot().context.schema).toEqual(schema);
  actor.stop();
});
