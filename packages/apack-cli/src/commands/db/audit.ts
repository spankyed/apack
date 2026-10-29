// Offline audit reserves the profile against managed writers and inspects read-only owners via private copies.
import { databaseStorage, findRunningApp, holdDatabaseWriteLock } from '@apackdev/host/database';
import { databaseSelection, withSelectedDatabases } from './stores';
import { openTarget, parseDbArgs, TARGET_USAGE, withDatabase, type DbIo } from './target';

export const AUDIT_USAGE = [
  'Usage: apack db audit --data-dir <path> [options]',
  '',
  'Inspect the SQLite candidate without repairing it. Quit the app first and name the profile.',
  'Checks primary value decoding, identity counters, embeddings, FTS postings and reconstructed derived contents.',
  'Uses private disk copies plus rebuild space. Findings and incomplete indexes cause failure.',
  '',
  '  --database <store>     primary (default), runs, or all; stores are checked separately',
  '  --json                 Print one report per selected store as JSON',
  TARGET_USAGE,
].join('\n');

export async function dbAudit(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, {
    database: { type: 'string', default: 'primary' }, json: { type: 'boolean', default: false },
  }, AUDIT_USAGE);
  if (positionals.length) throw new Error(`Unexpected argument ${positionals[0]}\n\n${AUDIT_USAGE}`);
  if (!target.named) throw new Error('Name the data dir to audit: --profile <name> or --data-dir <path>');
  const selection = databaseSelection(values.database);
  const lock = holdDatabaseWriteLock(target.userDataDir, 'apack db audit');
  try {
    if (findRunningApp(target)) throw new Error('Quit the app before auditing its database.');
    const app = await openTarget(target, { write: false, command: 'audit' }, io);
    await withDatabase(app, async () => {
      const storage = databaseStorage(app.database.format);
      if (!storage.audit) throw new Error(`Audit is not implemented for ${storage.format}`);
      await withSelectedDatabases(app, selection, false, async stores => {
        const failed: string[] = [];
        for (const store of stores) {
          const report = await storage.audit!(store.database);
          if (values.json) io.out(JSON.stringify({ database: store.name, ...report }));
          else {
            io.out(`${store.name}: ${report.ok ? 'clean' : 'issues found'}; ${report.checkedEntities} entities, ${report.checkedRelations} relations, ${report.comparedIndexes} indexes compared`);
            for (const issue of report.issues) io.out('  ' + issue);
            if (report.issueCount > report.issues.length) io.out(`  ${report.issueCount - report.issues.length} additional findings not displayed`);
          }
          if (!report.ok) failed.push(store.name);
        }
        if (failed.length) throw new Error(`Audit found issues in ${failed.join(', ')}; no repairs were made`);
      });
    });
  } finally { lock.release(); }
}
