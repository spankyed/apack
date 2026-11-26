// The database surface's backup flow: an export or import is in progress from the ask until the system answers it,
// and how it ended is kept for the Backup & Restore view to report.
import { expect, it } from 'vitest';
import { system, type EventsOf, type Outcome, type ViewUpdate } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import databaseState, { isRunningCode } from '#features/database/fe/state.ts';

interface RecordedAsk {
  to: string;
  name: string;
  args: Record<string, unknown>;
  stopped: boolean;
  done: (outcome: Outcome<unknown>) => void;
}

interface RecordedView {
  feature: string;
  view: string;
  args: object;
  stopped: boolean;
  updated: (update: ViewUpdate<unknown>) => void;
}

function startDatabase() {
  const asks: RecordedAsk[] = [];
  const views: RecordedView[] = [];
  const guard = defectGuard();
  const sys = system({
    side: 'window',
    onDefect: guard.onDefect,
    views: (feature, view, args, updated) => {
      const entry: RecordedView = { feature, view, args, stopped: false, updated };
      views.push(entry);
      return () => { entry.stopped = true; };
    },
  });
  sys.attach({
    tell: () => {},
    ask: (to, name, args, _progress, done) => {
      const entry: RecordedAsk = { to, name, args: (args ?? {}) as Record<string, unknown>, stopped: false, done };
      asks.push(entry);
      return () => { entry.stopped = true; };
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start('default-setup/database', databaseState);

  const asked = (name: string, nth = 0) => {
    const ask = asks.filter((made) => made.name === name)[nth];
    if (!ask) throw new Error(`no ${name} #${nth} was asked`);
    return ask;
  };

  const end = async (ask: RecordedAsk, outcome: Outcome<unknown>) => {
    // An ask that was stopped is never answered: its answer, when it comes, is nobody's
    if (!ask.stopped) ask.done(outcome);
    await sys.idle();
  };

  return {
    sys,
    handle,
    asks,
    views,
    asked,
    answer: (ask: RecordedAsk, value: unknown) => end(ask, { ok: true, value }),
    fail: (ask: RecordedAsk, failure: { kind: string; message: string; [key: string]: unknown }) =>
      end(ask, { ok: false, failure: failure as never }),
    read: () => sys.read(handle),
    send: (event: EventsOf<typeof databaseState>) => sys.send(handle, event),
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

type Console = ReturnType<typeof startDatabase>;

function backupView() {
  const ctx = startDatabase();
  ctx.send({ type: 'VIEW_BACKUP' });
  return ctx;
}

const backup = (ctx: Console) => {
  const snap = ctx.read();
  return { exporting: snap.pending.export, importing: snap.pending.import, backupResult: snap.data.backupResult };
};

it('retains the import result instructions for the backup view', async () => {
  const ctx = backupView();
  try {
    const message = 'Import successful. Please restart the brain manually.';
    ctx.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1' });
    await ctx.answer(ctx.asked('IMPORT_DATABASE'), { message });
    expect(backup(ctx).backupResult).toEqual({ operation: 'import', error: undefined, message });
  } finally {
    ctx.cleanup();
  }
});

// The answer to the asker's own import or reset, and the notification every window hears when any one of them
// replaced the data
it.each([
  ['IMPORT_DATABASE answered', async (ctx: Console) => {
    ctx.send({ type: 'VIEW_BACKUP' });
    ctx.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1' });
    await ctx.answer(ctx.asked('IMPORT_DATABASE'), { message: 'Completed' });
  }],
  ['RESET_DATABASE answered', async (ctx: Console) => {
    ctx.send({ type: 'DATABASE.RESET' });
    await ctx.answer(ctx.asked('RESET_DATABASE'), { message: 'Completed' });
  }],
  ['DATABASE_REPLACED', async (ctx: Console) => { ctx.send({ type: 'DATABASE_REPLACED' }); }],
] as const)(
  '%s discards old database results and late replies without restarting the window', async (_, replace) => {
    const ctx = startDatabase();
    try {
      ctx.send({ type: 'QUERY.UPDATE', code: 'return "keep this editor"' });
      ctx.send({ type: 'QUERY.EXECUTE', code: 'return "old rows"' });
      await ctx.answer(ctx.asked('EXECUTE_QUERY'), { result: 'old rows', executionTime: 1 });
      expect(ctx.read().data.queryResult).toBe('old rows');
      ctx.send({ type: 'QUERY.EXECUTE', code: 'return "late rows"' });
      const abandoned = ctx.asked('EXECUTE_QUERY', 1);
      await replace(ctx);
      expect(ctx.read().data).toMatchObject({ currentQuery: 'return "keep this editor"', queryResult: null });
      expect(isRunningCode(ctx.read().pending), 'the query under way was given up').toBe(false);
      await ctx.answer(abandoned, { result: 'late rows', executionTime: 2 });
      expect(ctx.read().data.queryResult).toBeNull();
    } finally {
      ctx.cleanup();
    }
  },
);

it('keeps mutable run history state separate between windows', () => {
  const first = startDatabase();
  const second = startDatabase();
  try {
    expect(first.read().data.expandedNodes).not.toBe(second.read().data.expandedNodes);
    expect(first.read().data.nodeDetails).not.toBe(second.read().data.nodeDetails);
    first.send({ type: 'RUNS.EXPAND_NODE', nodeId: 'row-from-first-window' });
    expect(first.read().data.expandedNodes.has('row-from-first-window')).toBe(true);
    expect(second.read().data.expandedNodes.size).toBe(0);
  } finally {
    first.cleanup();
    second.cleanup();
  }
});

it('keeps the current database results when import is refused', async () => {
  const ctx = startDatabase();
  try {
    ctx.send({ type: 'QUERY.EXECUTE', code: 'return "current rows"' });
    await ctx.answer(ctx.asked('EXECUTE_QUERY'), { result: 'current rows', executionTime: 1 });
    ctx.send({ type: 'VIEW_BACKUP' });
    ctx.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1' });
    await ctx.fail(ctx.asked('IMPORT_DATABASE'), { kind: 'failed', message: 'Invalid settings' });
    expect(ctx.read().data.queryResult).toBe('current rows');
    expect(backup(ctx).backupResult?.error).toBe('Invalid settings');
  } finally {
    ctx.cleanup();
  }
});

it('exports until the system answers', async () => {
  const ctx = backupView();
  try {
    ctx.send({ type: 'BACKUP.EXPORT', path: '/backups', databases: ['lmdb'] });
    expect(backup(ctx)).toEqual({ exporting: true, importing: false, backupResult: null });

    expect(ctx.asked('EXPORT_DATABASE').args).toEqual({ path: '/backups', name: undefined, databases: ['lmdb'] });
    await ctx.answer(ctx.asked('EXPORT_DATABASE'), { path: '/backups/backup-1' });
    expect(backup(ctx)).toEqual({ exporting: false, importing: false, backupResult: { operation: 'export', error: undefined } });
  } finally {
    ctx.cleanup();
  }
});

it('keeps an import failure, also after leaving the backup view', async () => {
  const ctx = backupView();
  try {
    ctx.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1' });
    expect(backup(ctx).importing).toBe(true);
    ctx.send({ type: 'BACK_TO_EXPLORER' });

    await ctx.fail(ctx.asked('IMPORT_DATABASE'), { kind: 'failed', message: 'no manifest' });
    expect(backup(ctx)).toEqual({ exporting: false, importing: false, backupResult: { operation: 'import', error: 'no manifest' } });
  } finally {
    ctx.cleanup();
  }
});

it("keeps the stores a newer apack's backup holds, so the view can ask, and imports without them when told to", async () => {
  const ctx = backupView();
  try {
    ctx.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1' });
    await ctx.fail(ctx.asked('IMPORT_DATABASE'), { kind: 'unknown-databases', message: 'a newer apack made it', unknownDatabases: ['searchIndex'] });
    expect(backup(ctx)).toEqual({
      exporting: false,
      importing: false,
      backupResult: { operation: 'import', error: 'a newer apack made it', unknownDatabases: ['searchIndex'] },
    });

    // What the view sends once the user has said to import it anyway
    ctx.send({ type: 'BACKUP.IMPORT', path: '/backups/backup-1', skipUnknownDatabases: true });
    expect(ctx.asked('IMPORT_DATABASE', 1).args).toEqual({ path: '/backups/backup-1', skipUnknownDatabases: true });
  } finally {
    ctx.cleanup();
  }
});

// The Database settings' "Reset database" sends DATABASE.RESET to the surface, whichever view it has open
it.each([
  ['the explorer', () => startDatabase()],
  ['the backup view', backupView],
])('asks the system to reset the database from %s', (_, open) => {
  const ctx = open();
  try {
    ctx.send({ type: 'DATABASE.RESET' });
    expect(ctx.asked('RESET_DATABASE').args).toEqual({});
  } finally {
    ctx.cleanup();
  }
});

// What the schema view delivers is what the panel shows, and a replacement leaves it to the view
it('holds what the schema view last delivered through a replacement', async () => {
  const ctx = startDatabase();
  try {
    expect(ctx.views).toHaveLength(0);
    ctx.send({ type: 'SURFACE_STARTED', ownsAppLayout: true });
    expect(ctx.views).toHaveLength(1);
    expect(ctx.views[0]).toMatchObject({ feature: 'default-setup/database', view: 'schema', stopped: false });

    const schema = { entities: [{ type: 'Note', count: 1, fields: [], relations: [] }], attributes: [], relations: [] };
    ctx.views[0].updated({ ok: true, value: schema });
    await ctx.sys.idle();
    expect(ctx.read().data.schema).toEqual(schema);
    ctx.send({ type: 'DATABASE_REPLACED' });
    expect(ctx.read().data.schema).toEqual(schema);
  } finally {
    ctx.cleanup();
  }
});
