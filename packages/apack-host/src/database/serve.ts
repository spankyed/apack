// An app's database as a server: what `apack db` asks the app running on a data dir to do, answered in the process
// that holds the data, so a tool reads what the app's views read and writes through the app's own engine. Offline,
// `apack db` opens the files and runs the same code here (`consoleScope`, `runDatabaseScript`), so a command means
// the same thing either way.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as v8 from 'node:v8';
import { pathToFileURL } from 'node:url';
import type { RecordStore } from '@apackdev/ears';
import { consoleEars, runQueryCode, runTransactionCode, type ConsoleScope } from '@apackdev/sdk/database-console';
import { _createRunHistory, type RunNode, type RunNodeId } from '@apackdev/sdk/services';
import type { EARS } from '@apackdev/ears';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import type { AppDatabase } from './open.ts';

/** Where a running app's API takes a database request (`POST`, with the API token) */
export const DATABASE_REQUEST_PATH = '/db';

/** What `apack db` asks of the database */
export type DatabaseRequest =
  /** Console code: a query sees the read helpers, an exec runs as one transaction with the write helpers too */
  | { kind: 'query' | 'exec'; code: string }
  /** The run history: one run's tree, or the runs newest first */
  | { kind: 'runs'; run?: string; flowId?: string; limit: number }
  /** A script, compiled to one ES module (`source`), called as `apack db script` calls it */
  | { kind: 'script'; file: string; source: string; args: string[] };

/** The answer: the result and the lines a script logged, or why it failed */
export type DatabaseAnswer = { result: unknown; lines: string[] } | { error: string };

/** The database a request is answered over: the open database, and the run history beside it */
export type ServedDatabase = Omit<AppDatabase, 'close'> & { runHistory: RecordStore<RunNode> };

/** What a script's default export is called with */
export interface DatabaseScriptContext {
  db: Omit<AppDatabase, 'close'>;
  EARS: object;
  /** The arguments after `--` */
  args: string[];
  log(line: string): void;
}

/**
 * `EARS` for console code: the SDK's names, the installed packs' — and the entity types the data turned out to
 * hold, so that a type whose pack is gone can still be named in a query.
 *
 * **Declared wins on a collision**, so a pack's name keeps the value it declared and an observed type only ever
 * adds a name that stood for nothing. That ordering is the whole of what keeps this a widening of the console
 * rather than of the schema: `db.schema` still means *declared*. The engine's entity-type check is wider —
 * `openAppDatabase` adds the types hydration found, so a write naming an observed type goes through, unchecked
 * by any pack.
 *
 * **`relKinds` and `roles` are deliberately not widened.** `EARS.RelKind.RELATES_TO` is `'relates_to'` and the data
 * holds only the value, so no amount of observation produces the alias; a dir with no snapshots has to be given one.
 */
export function consoleScope(db: Pick<AppDatabase, 'ears' | 'schema'>): ConsoleScope {
  const observed = Object.fromEntries(Object.keys(db.ears.getSchemaStats().entities).map((type) => [type, type]));
  return {
    EARS: consoleEars({ entities: { ...observed, ...db.schema.entities }, relKinds: db.schema.relKinds, roles: db.schema.roles }, {
      hint: 'Name the pack that declares it with --schema-from, which takes a snapshot, a pack, or a directory of packs.',
    }),
  };
}

/** What the script failed with, named after the script, so a failure is never read as the CLI's own */
function scriptFailure(file: string, error: unknown): Error {
  return new Error(`${file} failed: ${errorMessage(error)}`, { cause: error });
}

/** A script compiled to one ES module, imported from a temp file that is removed once it has loaded */
export async function importScriptSource(file: string, source: string): Promise<{ default?: unknown }> {
  const compiled = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-db-script-')), `${path.basename(file)}.mjs`);
  try {
    fs.writeFileSync(compiled, source);
    return await import(pathToFileURL(compiled).href) as { default?: unknown };
  } catch (error) {
    throw scriptFailure(file, error);
  } finally {
    fs.rmSync(path.dirname(compiled), { recursive: true, force: true });
  }
}

/** Calls a script module's default export with its context; what it throws or rejects with is named after the script */
export async function runDatabaseScript(module: { default?: unknown }, file: string, context: DatabaseScriptContext): Promise<unknown> {
  if (typeof module.default !== 'function') {
    throw new Error(`${file} exports no function to run: export default ({ db, EARS, args, log }) => { ... }`);
  }
  try {
    return await (module.default as (context: DatabaseScriptContext) => unknown)(context);
  } catch (error) {
    throw scriptFailure(file, error);
  }
}

/** Answers a request over the database this process holds; a failure is an answer, never a throw */
export async function answerDatabaseRequest(request: DatabaseRequest, database: ServedDatabase): Promise<DatabaseAnswer> {
  const lines: string[] = [];
  try {
    switch (request.kind) {
      case 'query':
        return { result: await runQueryCode(request.code, consoleScope(database)), lines };
      case 'exec':
        return { result: await runTransactionCode(request.code, consoleScope(database)), lines };
      case 'runs': {
        const history = _createRunHistory(database.runHistory);
        // A run that isn't there is `null`, which the command reports as it does offline
        if (request.run !== undefined) return { result: history.tree(request.run as RunNodeId) ?? null, lines };
        return { result: history.findRuns({ limit: request.limit, ...(request.flowId !== undefined && { flowId: request.flowId as EARS.EntityId }) }), lines };
      }
      case 'script': {
        const module = await importScriptSource(request.file, request.source);
        const { runHistory: _runHistory, ...db } = database;
        const result = await runDatabaseScript(module, request.file, { db, EARS: consoleScope(database).EARS, args: request.args, log: (line) => lines.push(line) });
        return { result, lines };
      }
    }
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

/**
 * An answer as the API sends it: the structured clone of it (`node:v8`), so a result arrives as the code returned it —
 * Dates, BigInts, Maps and `undefined` included — and prints as it does offline. A result that cannot be cloned
 * (a function) is answered as the failure it is.
 */
export function encodeDatabaseAnswer(answer: DatabaseAnswer): Buffer {
  try {
    return v8.serialize(answer);
  } catch (error) {
    return v8.serialize({ error: `The result can't be sent from the app: ${errorMessage(error)}` } satisfies DatabaseAnswer);
  }
}

export const decodeDatabaseAnswer = (body: Uint8Array): DatabaseAnswer => v8.deserialize(body) as DatabaseAnswer;
