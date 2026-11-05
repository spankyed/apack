// apack db script: a script file run against the data dir's database, for work a console one-liner can't do (it
// imports what it likes, and keeps its own helpers). The database is handed to it, rather than left for it to open:
// the published CLI carries its own copy of the engine, so a script importing @apackdev/ears would get a second one.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { AppDatabase } from '@apackdev/host/database';
import { consoleScope, openTarget, parseDbArgs, TARGET_USAGE, withDatabase, withoutAdmin, type DbIo } from './target';
import { flushOutput, outputFormat, writeResult } from './output';
import { errorMessage } from '@apackdev/sdk/utils/pure';

const OPTIONS = {
  'read-only': { type: 'boolean', default: false },
  admin: { type: 'boolean', default: false },
  output: { type: 'string', short: 'o' },
  out: { type: 'string' },
} as const;

export const SCRIPT_USAGE = [
  'Usage: apack db script <file> [options] [-- <script arguments>]',
  '',
  'Runs a script file (.ts, .mts, .js or .mjs) against the database. The file default-exports a function, which is',
  'called with the open database and returns its result, printed like a query\'s:',
  '',
  '  export default async ({ db, EARS, args, log }) => {',
  '    const notes = db.ears.query(EARS.Entity.Note).ids();',
  '    log(`${notes.length} notes`);',
  '    return notes.map((id) => db.ears.getRow(id));',
  '  };',
  '',
  '  db     the open database: ears (query, create, upsert, write, the finders), schema, paths',
  '  EARS   the entity types and relation kinds of the packs installed in the data dir',
  '  args   what follows -- on the command line',
  '  log    prints a line, like the script\'s own output',
  '',
  'Options:',
  '  --read-only            Open the database without writing',
  '  --admin                Also db.admin and db.database, for schema changes and resets: holds the data dir\'s lock, and needs apack closed on it',
  '  -o, --output <format>  pretty (default), json or csv, for what the script returns',
  '  --out <file>           Write that result to a file',
  TARGET_USAGE,
].join('\n');

/** What a script's default export is called with */
export interface DbScriptContext {
  db: AppDatabase;
  EARS: object;
  /** The arguments after `--` */
  args: string[];
  log(line: string): void;
}

/** JavaScript this Node runs as it is */
const JAVASCRIPT = /\.(mjs|cjs|js)$/;

/**
 * The script as a module. TypeScript is compiled first, into a temp file rather than the script's own directory,
 * which may be one this user can't write: this process runs through tsx, whose importer only transforms files inside
 * the project, so a script anywhere else would reach Node as TypeScript it can't read. Its relative imports are
 * compiled in and its packages are resolved, from where the script lives, to the paths they have there, so the
 * compiled copy loads the same modules wherever it sits.
 */
async function importScript(scriptFile: string): Promise<{ default?: unknown }> {
  if (JAVASCRIPT.test(scriptFile)) return import(pathToFileURL(scriptFile).href) as Promise<{ default?: unknown }>;

  const { build } = await import('esbuild');
  const resolveFromScript = createRequire(scriptFile);
  const { outputFiles } = await build({
    entryPoints: [scriptFile],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: false,
    absWorkingDir: path.dirname(scriptFile),
    // The script's own file, not the compiled copy, is what `import.meta` points at
    define: {
      'import.meta.url': JSON.stringify(pathToFileURL(scriptFile).href),
      'import.meta.filename': JSON.stringify(scriptFile),
      'import.meta.dirname': JSON.stringify(path.dirname(scriptFile)),
    },
    plugins: [{
      name: 'packages-from-the-script',
      setup(bundler) {
        bundler.onResolve({ filter: /^[^./]/ }, ({ path: specifier }) => {
          if (specifier.startsWith('node:') || builtinModules.includes(specifier)) return { path: specifier, external: true };
          try {
            // Kept out of the bundle, at the path it has next to the script, so the compiled copy finds it too
            return { path: resolveFromScript.resolve(specifier), external: true };
          } catch {
            // Not installed there: left as it is, so Node reports it against the name the script used
            return { path: specifier, external: true };
          }
        });
      },
    }],
  });

  const compiled = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-db-script-')), `${path.basename(scriptFile)}.mjs`);
  try {
    fs.writeFileSync(compiled, outputFiles[0].text);
    return await import(pathToFileURL(compiled).href) as { default?: unknown };
  } finally {
    fs.rmSync(path.dirname(compiled), { recursive: true, force: true });
  }
}

/** What the script failed with, named after the script, so a failure is never read as the CLI's own */
function scriptFailure(scriptFile: string, error: unknown): Error {
  return new Error(`${scriptFile} failed: ${errorMessage(error)}`, { cause: error });
}

export async function dbScript(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, OPTIONS, SCRIPT_USAGE);
  const format = outputFormat(values.output);
  const [file, ...scriptArgs] = positionals;
  if (!file) throw new Error(`Name the script to run\n\n${SCRIPT_USAGE}`);
  const scriptFile = path.resolve(file);
  if (!fs.existsSync(scriptFile)) throw new Error(`No script at ${scriptFile}`);

  // A script writes rows unless it says otherwise, and a running app is told once it ends
  const changes = values['read-only'] ? 'nothing' : values.admin ? 'everything' : 'rows';
  const db = await openTarget(target, { changes, command: 'script' }, io);
  try {
    const result = await withDatabase(db, async () => {
      const module = await importScript(scriptFile).catch((error: unknown) => { throw scriptFailure(scriptFile, error); });
      if (typeof module.default !== 'function') {
        throw new Error(`${scriptFile} exports no function to run: export default ({ db, EARS, args, log }) => { ... }`);
      }
      const context: DbScriptContext = { db: values.admin ? db : withoutAdmin(db), EARS: consoleScope(db).EARS, args: scriptArgs, log: io.out };
      try {
        // Awaited here, inside withDatabase: the script's own work — its writes, an interactive question — finishes
        // before the database is closed, and what it throws or rejects with fails the command rather than being lost
        return await (module.default as (context: DbScriptContext) => unknown)(context);
      } catch (error) {
        throw scriptFailure(scriptFile, error);
      }
    });
    if (result !== undefined) writeResult(result, { format, out: values.out as string | undefined }, io);
  } finally {
    // What the script printed reaches stdout before the CLI exits, which drops whatever is still buffered for a pipe
    await flushOutput();
  }
}
