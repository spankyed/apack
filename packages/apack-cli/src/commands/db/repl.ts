// apack db repl: console code line by line, on the data dir's database
import type { AppDatabase } from '@apackdev/host/database';
import * as readline from 'node:readline/promises';
import { runQueryCode, runTransactionCode } from '@apackdev/sdk/database-console';
import { consoleScope, openTarget, parseDbArgs, TARGET_USAGE, withDatabase, type DbIo } from './target';

/** What elmdb's refusal says when another process changed the schema after this handle opened */
const SCHEMA_CHANGED_MESSAGE = 'Another process changed the database schema';
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
  '  --write                Transaction code: the write helpers too. Each line is saved',
  TARGET_USAGE,
].join('\n');

export async function dbRepl(args: string[], io: DbIo, input: NodeJS.ReadableStream = process.stdin): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, OPTIONS, REPL_USAGE);
  if (positionals.length > 0) throw new Error(`Unexpected argument ${positionals[0]}\n\n${REPL_USAGE}`);
  const write = values.write as boolean;
  const open = () => openTarget(target, { changes: write ? 'rows' : 'nothing', command: 'repl' }, io);
  let db = await open();
  let scope = consoleScope(db);
  const run = write ? runTransactionCode : runQueryCode;
  const lines = readline.createInterface({ input, terminal: false });
  io.err(`${write ? 'Transaction' : 'Query'} code, one line at a time; .exit to quit`);
  const session: AppDatabase = { ...db, close: () => db.close() };
  await withDatabase(session, async () => {
    try {
      for await (const line of lines) {
        const code = line.trim();
        if (code === '.exit') break;
        if (!code) continue;
        try {
          let answer;
          try {
            answer = await run(code, scope);
          } catch (error) {
            // The app declared a schema after this session opened, as it may on restarting: nothing was written
            if (!(error as Error).message.includes(SCHEMA_CHANGED_MESSAGE)) throw error;
            db.close();
            db = await open();
            scope = consoleScope(db);
            answer = await run(code, scope);
          }
          io.out(toPretty(answer));
        } catch (error) {
          io.err(`Error: ${(error as Error).message}`);
        }
      }
    } finally {
      lines.close();
    }
  });
}
