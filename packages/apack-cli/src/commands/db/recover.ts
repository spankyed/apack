import { listImportRecoveries, restoreImportRecovery } from '@apackdev/host/backup';
import { configuredDatabaseFormat } from '@apackdev/host/database';
import { parseDbArgs, TARGET_USAGE, type DbIo } from './target';

export const RECOVER_USAGE = [
  'Usage: apack db recover [--session <name> --restore] [--json] [options]', '',
  'Inspect interrupted imports in an explicitly named profile. Without --restore, data is unchanged.',
  '--restore restores the selected session’s retained incumbent stores and media while the app is closed.',
  'Interrupted live files and retained copies remain in that session for inspection. A repeated restore resumes',
  'an interrupted recovery; a completed session is never restored again.', '',
  '  --session <name>      One .apack-import-* session reported by this command',
  '  --restore             Explicitly restore that session’s incumbent copies',
  '  --json                Structured output', TARGET_USAGE,
].join('\n');

export async function dbRecover(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, {
    session: { type: 'string' }, restore: { type: 'boolean' }, json: { type: 'boolean' },
  }, RECOVER_USAGE);
  if (positionals.length || !target.named || target.schemaFrom !== undefined
    || (values.restore ? typeof values.session !== 'string' || !values.session.trim() : values.session !== undefined)) {
    throw new Error(`Name the profile to inspect or recover; restoration also requires --session and --restore.\n\n${RECOVER_USAGE}`);
  }
  io.err(`Database: ${target.userDataDir} (offline recovery)`);
  const results = values.restore
    ? [restoreImportRecovery({ ...target, storageFormat: configuredDatabaseFormat(target.userDataDir) }, values.session as string)]
    : listImportRecoveries(target.userDataDir);
  if (values.json) io.out(JSON.stringify(results));
  else if (!results.length) io.out('No interrupted import sessions.');
  else for (const result of results) io.out(`${result.session}: ${result.status}\n  Retained incumbent copies: ${result.recoveryPath}`);
}
