// apack db script: a script file run against the data dir's database, for work a console one-liner can't do (it
// imports what it likes, and keeps its own helpers). The database is handed to it, rather than left for it to open:
// the published CLI carries its own copy of the engine, so a script importing @apackdev/ears would get a second one.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { consoleScope, importScriptSource, runDatabaseScript } from '@apackdev/host/database';
import { askRunningApp } from './app';
import { openTarget, parseDbArgs, requireNamedForWrite, TARGET_USAGE, withDatabase, type DbIo } from './target';
import { flushOutput, outputFormat, writeResult } from './output';
import { errorMessage } from '@apackdev/sdk/utils/pure';

const OPTIONS = {
  'read-only': { type: 'boolean', default: false },
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
  '  db     the open database: ears (query, create, upsert, write, the finders), admin, store, schema, paths, userDataDir',
  '  EARS   the entity types and relation kinds of the packs installed in the data dir',
  '  args   what follows -- on the command line',
  '  log    prints a line, like the script\'s own output',
  '',
  'Options:',
  '  --read-only            Open the database without writing, rather than run in the app running on it',
  '  -o, --output <format>  pretty (default), json or csv, for what the script returns',
  '  --out <file>           Write that result to a file',
  TARGET_USAGE,
].join('\n');

/** JavaScript this Node runs as it is */
const JAVASCRIPT = /\.(mjs|cjs|js)$/;

/**
 * The script compiled to one ES module: its relative imports compiled in and its packages resolved, from where the
 * script lives, to the paths they have there, so the module loads the same modules wherever it is imported from — a
 * temp file here, or the running app, which imports it in its own process. It is compiled rather than imported as it
 * is because this process runs through tsx, whose importer only transforms files inside the project, so a script
 * anywhere else would reach Node as TypeScript it can't read.
 */
async function compileScript(scriptFile: string): Promise<string> {
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
  return outputFiles[0].text;
}

/** What the script failed to compile with, named after the script, so a failure is never read as the CLI's own */
async function compiled(scriptFile: string): Promise<string> {
  try {
    return await compileScript(scriptFile);
  } catch (error) {
    throw new Error(`${scriptFile} failed: ${errorMessage(error)}`, { cause: error });
  }
}

/** The script as a module offline: JavaScript as it is, TypeScript compiled */
async function importScript(scriptFile: string): Promise<{ default?: unknown }> {
  if (!JAVASCRIPT.test(scriptFile)) return importScriptSource(scriptFile, await compiled(scriptFile));
  try {
    return await import(pathToFileURL(scriptFile).href) as { default?: unknown };
  } catch (error) {
    throw new Error(`${scriptFile} failed: ${errorMessage(error)}`, { cause: error });
  }
}

export async function dbScript(args: string[], io: DbIo): Promise<void> {
  const { values, positionals, target } = parseDbArgs(args, OPTIONS, SCRIPT_USAGE);
  const format = outputFormat(values.output);
  const [file, ...scriptArgs] = positionals;
  if (!file) throw new Error(`Name the script to run\n\n${SCRIPT_USAGE}`);
  const scriptFile = path.resolve(file);
  if (!fs.existsSync(scriptFile)) throw new Error(`No script at ${scriptFile}`);

  // A script writes unless it says it only reads. The running app runs one that writes in its own process, over the
  // data it holds; one that only reads runs offline, where opening the files read-only is what keeps it to its word,
  // and every commit the app made is there to read
  const write = !values['read-only'];
  requireNamedForWrite(target, write);
  try {
    const answered = write
      ? await askRunningApp(target, async () => ({ kind: 'script', file: scriptFile, source: await compiled(scriptFile), args: scriptArgs }), io)
      : null;
    const result = answered ? answered.result : await (async () => {
      const db = await openTarget(target, { write, command: 'script' }, io);
      // Awaited inside withDatabase: the script's own work — its writes, an interactive question — finishes before
      // the database is closed, and what it throws or rejects with fails the command rather than being lost
      return withDatabase(db, async () =>
        runDatabaseScript(await importScript(scriptFile), scriptFile, { db, EARS: consoleScope(db).EARS, args: scriptArgs, log: io.out }));
    })();
    if (result !== undefined) writeResult(result, { format, out: values.out as string | undefined }, io);
  } finally {
    // What the script printed reaches stdout before the CLI exits, which drops whatever is still buffered for a pipe
    await flushOutput();
  }
}
