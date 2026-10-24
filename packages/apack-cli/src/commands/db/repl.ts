// apack db repl: console code line by line, on the data dir's database
import * as readline from 'node:readline/promises';
import { runQueryCode, runTransactionCode } from '@apackdev/sdk/database-console';
import { consoleScope } from '@apackdev/host/database';
import { openTarget, parseDbArgs, TARGET_USAGE, withDatabase, type DbIo } from './target';
import { toPretty } from './output';

const OPTIONS = {
  write: { type: 'boolean', default: false },
} as const;

export const REPL_USAGE = [
  'Usage: apack db repl [--write] [options]',
  '',
  'Runs each line you enter as query code (with --write, as transaction code) and prints its result. A line is a',
  'function body: `return query(EARS.Entity.Note).count()`. .exit (or Ctrl+D) closes the database and exits.',
  '',
  'Options:',
  '  --write                Transaction code: the write helpers too, and the changes are saved on exit',
  TARGET_USAGE,
].join('\n');

export async function dbRepl(args: string[], io: DbIo, input: NodeJS.ReadableStream = process.stdin): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, OPTIONS, REPL_USAGE);
  if (positionals.length > 0) throw new Error(`Unexpected argument ${positionals[0]}\n\n${REPL_USAGE}`);
  const write = values.write as boolean;
  const db = await openTarget(target, { write, command: 'repl' }, io);
  const scope = consoleScope(db);
  const run = write ? runTransactionCode : runQueryCode;
  const lines = readline.createInterface({ input, terminal: false });
  io.err(`${write ? 'Transaction' : 'Query'} code, one line at a time; .exit to quit`);
  await withDatabase(db, async () => {
    try {
      for await (const line of lines) {
        const code = line.trim();
        if (code === '.exit') break;
        if (!code) continue;
        try {
          io.out(toPretty(await run(code, scope)));
        } catch (error) {
          io.err(`Error: ${(error as Error).message}`);
        }
      }
    } finally {
      lines.close();
    }
  });
}
