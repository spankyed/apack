// apack db: the app's database, opened offline (@apackdev/host/database)
import { CLEAR_SETTINGS_USAGE, dbClearSettings, dbImport, dbReset, IMPORT_USAGE, RESET_USAGE } from './destructive';
import { dbExec, dbQuery, EXEC_USAGE, QUERY_USAGE } from './code';
import { VERIFY_USAGE } from './backup-verify';
import { dbBackup, BACKUP_USAGE } from './backup';
import { dbExport, EXPORT_USAGE } from './export';
import { dbImportRuns, IMPORT_RUNS_USAGE } from './import-runs';
import { dbInspect, INSPECT_USAGE } from './inspect';
import { dbRepl, REPL_USAGE } from './repl';
import { dbRuns, RUNS_USAGE } from './runs';
import { dbScript, SCRIPT_USAGE } from './script';
import { processIo, TARGET_USAGE, type DbIo } from './target';

const COMMANDS: Record<string, { run: (args: string[], io: DbIo) => Promise<void>; usage: string }> = {
  query: { run: dbQuery, usage: QUERY_USAGE },
  exec: { run: dbExec, usage: EXEC_USAGE },
  repl: { run: dbRepl, usage: REPL_USAGE },
  script: { run: dbScript, usage: SCRIPT_USAGE },
  inspect: { run: dbInspect, usage: INSPECT_USAGE },
  runs: { run: dbRuns, usage: RUNS_USAGE },
  backup: { run: dbBackup, usage: BACKUP_USAGE },
  export: { run: dbExport, usage: EXPORT_USAGE },
  import: { run: dbImport, usage: IMPORT_USAGE },
  'import-runs': { run: dbImportRuns, usage: IMPORT_RUNS_USAGE },
  reset: { run: dbReset, usage: RESET_USAGE },
  'clear-settings': { run: dbClearSettings, usage: CLEAR_SETTINGS_USAGE },
};

export const DB_USAGE = `
Usage: apack db <command> [options]

The app's database, read and changed while apack is closed. Commands that change it refuse while apack runs
on the data dir; reads warn that it is running, and read what it has committed.

Commands:
  query <code>          Run read-only query code (the Database console's)
  exec <code>           Run transaction code
  repl [--write]        Run console code line by line
  script <file>         Run a script file against the database (it imports what it likes)
  inspect [<id>]        An entity's relations, or relation counts per entity type
  runs [--run <id>]     The flow runs in the run history, or one run's whole tree
  backup --out <dir>    Full database and media backup to a new directory
  backup verify <dir>   Check backup readability and completeness
  export --out <dir>    Each entity type's entities to a file
  import <backup-dir>   Replace the database with a backup (lists the change; --force makes it)
  import-runs <dump>    A run history dumped from a record store, into an empty one (lists it; --force imports)
  reset                 Delete all data, as Reset Database does (lists it; --force deletes)
  clear-settings        Destroy the Settings rows, so defaults come back (lists them; --force destroys)

Every command takes one of these; a command that changes the database says which data dir it means, and a command
that only reads takes the production app's data without being told:
${TARGET_USAGE}

apack db <command> --help shows a command's options.
`.trim();

export async function db(args: string[], io: DbIo = processIo): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h') {
    io.out(DB_USAGE);
    return;
  }
  const entry = COMMANDS[command];
  if (!entry) throw new Error(`Unknown db command: ${command}\n\n${DB_USAGE}`);
  if (rest.includes('--help') || rest.includes('-h')) {
    io.out(command === 'backup' && rest[0] === 'verify' ? VERIFY_USAGE : entry.usage);
    return;
  }
  await entry.run(rest, io);
}
