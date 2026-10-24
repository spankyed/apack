// apack db query | exec: console code (the Database surface's) run on the data dir's database
import * as fs from 'node:fs';
import { runQueryCode, runTransactionCode } from '@apackdev/sdk/database-console';
import { consoleScope } from '@apackdev/host/database';
import { askRunningApp } from './app';
import { openTarget, parseDbArgs, requireNamedForWrite, TARGET_USAGE, withDatabase, type DbIo } from './target';
import { outputFormat, writeResult } from './output';

const OPTIONS = {
  file: { type: 'string', short: 'f' },
  output: { type: 'string', short: 'o' },
  out: { type: 'string' },
} as const;

const usage = (command: 'query' | 'exec') => [
  `Usage: apack db ${command} <code> | --file <path> [options]`,
  '',
  command === 'query'
    ? 'Runs read-only query code with the Database console\'s read helpers (query, getRow, findRelations, getSchemaStats, ...).'
    : 'Runs transaction code with the Database console\'s read and write helpers (create, upsert, write, ...).',
  'The code is a function body: return the result (`return query(EARS.Entity.Note).pickAll()`).',
  '',
  'Options:',
  '  -f, --file <path>      Read the code from a file',
  '  -o, --output <format>  pretty (default), json or csv',
  '  --out <file>           Write the result to a file',
  TARGET_USAGE,
].join('\n');

async function runCode(command: 'query' | 'exec', args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, OPTIONS, usage(command));
  const format = outputFormat(values.output);
  if (values.file && positionals.length > 0) throw new Error(`Pass the code or --file, not both\n\n${usage(command)}`);
  const code = values.file ? fs.readFileSync(values.file as string, 'utf-8') : positionals.join(' ');
  if (!code.trim()) throw new Error(`No code to run\n\n${usage(command)}`);

  const write = command === 'exec';
  requireNamedForWrite(target, write);
  // The running app answers over the data it holds; offline, the files are opened and the same code runs here
  const answered = await askRunningApp(target, () => ({ kind: command, code }), io);
  const result = answered ? answered.result : await (async () => {
    const db = await openTarget(target, { write, command }, io);
    return withDatabase(db, () => (write ? runTransactionCode(code, consoleScope(db)) : runQueryCode(code, consoleScope(db))));
  })();
  writeResult(result, { format, out: values.out as string | undefined }, io);
}

export const QUERY_USAGE = usage('query');
export const EXEC_USAGE = usage('exec');
export const dbQuery = (args: string[], io: DbIo) => runCode('query', args, io);
export const dbExec = (args: string[], io: DbIo) => runCode('exec', args, io);
