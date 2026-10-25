// The database surface's backup flow: an export or import is in progress from the request until the
// system reports how it ended, and the outcome is kept for the Backup & Restore view to report.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { answerTo } from '@apackdev/sdk/testing';
import { sentCall } from '../../../_support/calls.ts';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));

const { default: databaseState } = await import('#features/database/fe/state.ts');

function backupView() {
  const actor = createActor(databaseState).start();
  actor.send({ type: 'VIEW_BACKUP' });
  return actor;
}

const backup = (actor: ReturnType<typeof backupView>) => {
  const { exporting, importing, backupResult } = actor.getSnapshot().context;
  return { exporting, importing, backupResult };
};

beforeEach(() => {
  sendToSystem.mockReset();
});

it('retains the import result instructions for the backup view', () => {
  const actor = backupView();
  const message = 'Import successful. Please restart the brain manually.';
  actor.send({ type: 'IMPORT_DATABASE_SUCCESS', message });
  expect(backup(actor).backupResult).toEqual({ operation: 'import', error: undefined, message });
  actor.stop();
});

// The asker's own outcome, and the notification every window hears when any one of them replaced the data
it.each(['IMPORT_DATABASE_SUCCESS', 'RESET_DATABASE_SUCCESS', 'DATABASE_REPLACED'] as const)(
  '%s discards old database results and late replies without restarting the window', type => {
    const actor = createActor(databaseState).start();
    actor.send({ type: 'QUERY.UPDATE', code: 'return "keep this editor"' });
    actor.send({ type: 'QUERY.EXECUTE', code: 'return "old rows"' });
    actor.send(answerTo(sentCall(sendToSystem, 'EXECUTE_QUERY'), { type: 'QUERY_RESULT', result: 'old rows', executionTime: 1 }));
    expect(actor.getSnapshot().context.queryResult).toBe('old rows');
    actor.send({ type: 'QUERY.EXECUTE', code: 'return "late rows"' });
    const abandoned = sentCall(sendToSystem, 'EXECUTE_QUERY', 1);
    actor.send({ type, message: 'Completed' });
    expect(actor.getSnapshot().context).toMatchObject({ currentQuery: 'return "keep this editor"',
      queryResult: null, isLoading: false, pendingQueryCall: null, pendingTransactionCall: null });
    actor.send(answerTo(abandoned, { type: 'QUERY_RESULT', result: 'late rows', executionTime: 2 }));
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

it('keeps the current database results when import is refused', () => {
  const actor = createActor(databaseState).start();
  actor.send({ type: 'QUERY.EXECUTE', code: 'return "current rows"' });
  actor.send(answerTo(sentCall(sendToSystem, 'EXECUTE_QUERY'), { type: 'QUERY_RESULT', result: 'current rows', executionTime: 1 }));
  actor.send({ type: 'IMPORT_DATABASE_ERROR', error: 'Invalid settings' });
  expect(actor.getSnapshot().context.queryResult).toBe('current rows');
  expect(backup(actor).backupResult?.error).toBe('Invalid settings');
  actor.stop();
});

it('exports until the system reports success', () => {
  const actor = backupView();

  actor.send({ type: 'BACKUP.EXPORT', path: '/backups', databases: ['lmdb'] });
  expect(backup(actor)).toEqual({ exporting: true, importing: false, backupResult: null });

  actor.send({ type: 'EXPORT_DATABASE_SUCCESS', path: '/backups/backup-1' });
  expect(backup(actor)).toEqual({ exporting: false, importing: false, backupResult: { operation: 'export', error: undefined } });
});

it('keeps an import failure, also after leaving the backup view', () => {
  const actor = backupView();

  actor.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1' });
  expect(backup(actor).importing).toBe(true);
  actor.send({ type: 'BACK_TO_EXPLORER' });

  actor.send({ type: 'IMPORT_DATABASE_ERROR', error: 'no manifest' });
  expect(backup(actor)).toEqual({ exporting: false, importing: false, backupResult: { operation: 'import', error: 'no manifest' } });
});

it("keeps the stores a newer apack's backup holds, so the view can ask, and imports without them when told to", () => {
  const actor = backupView();

  actor.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1' });
  actor.send({ type: 'IMPORT_DATABASE_ERROR', error: 'a newer apack made it', unknownDatabases: ['searchIndex'] });
  expect(backup(actor)).toEqual({
    exporting: false,
    importing: false,
    backupResult: { operation: 'import', error: 'a newer apack made it', unknownDatabases: ['searchIndex'] },
  });

  // What the view sends once the user has said to import it anyway
  actor.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1', skipUnknownDatabases: true });
  expect(sendToSystem).toHaveBeenCalledWith('database', { type: 'IMPORT_DATABASE', path: '/backups/backup-1', skipUnknownDatabases: true });
});

// The Database settings' "Reset database" sends DATABASE.RESET to the surface, whichever view it has open
it.each([
  ['the explorer', () => createActor(databaseState).start()],
  ['the backup view', backupView],
])('asks the system to reset the database from %s', (_, open) => {
  const actor = open();

  actor.send({ type: 'DATABASE.RESET' });

  expect(sendToSystem).toHaveBeenCalledWith('database', { type: 'RESET_DATABASE' });
});

// The schema walks the whole store, so it is fetched rather than watched: once the shell starts the surface (in a
// delivery naming it, so the ask can be answered), again whenever the data is replaced in any window, and after a
// transaction this window ran
it('asks for the schema when it starts, when the data is replaced, and after its own transaction', () => {
  const actor = createActor(databaseState).start();
  const asks = () => sendToSystem.mock.calls.filter(([, event]) => event.type === 'GET_SCHEMA').length;
  expect(asks(), 'nothing from the machine\'s own entry, which no delivery names').toBe(0);
  actor.send({ type: 'SURFACE_STARTED' });
  expect(asks()).toBe(1);
  actor.send({ type: 'SCHEMA_READ', schema: { entities: [{ type: 'Note' }], attributes: [], relations: [] } });
  expect(actor.getSnapshot().context.schema.entities).toEqual([{ type: 'Note' }]);

  actor.send({ type: 'DATABASE_REPLACED' });
  expect(asks()).toBe(2);

  actor.send({ type: 'TRANSACTION.EXECUTE', code: 'return 1' });
  actor.send(answerTo(sentCall(sendToSystem, 'EXECUTE_TRANSACTION'), { type: 'TRANSACTION_RESULT', result: 1, executionTime: 1 }));
  expect(asks()).toBe(3);
  actor.stop();
});
