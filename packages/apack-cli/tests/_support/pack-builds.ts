// Building real packs in a temp dir by running the CLI, for the specs that need a build rather than a
// hand-written snapshot. A pack here is a directory of files plus a `node_modules` symlink, which is
// what lets sibling packs resolve each other through `resolveFromWorkspace`.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { PACK_TSCONFIG } from '../../src/commands/init';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';

/** The CLI these specs build with: the repo's own bin, run from source */
export const CLI = path.join(REPO_ROOT, 'packages', 'apack-cli', 'bin', 'apack.mjs');

/**
 * The commands `callCli` can run, by the name the CLI's argv dispatch uses (`src/index.ts`). `build`
 * is the inner `build`, not `buildCommand`: focused compiler checks run in-process; process-boundary
 * checks use the actual CLI or its private build runner.
 */
const COMMANDS = {
  'init': async () => (await import('../../src/commands/init')).init,
  'add': async () => (await import('../../src/commands/add')).add,
  'generate-entries': async () => (await import('../../src/commands/generate-entries')).generateEntries,
  'build': async () => (await import('../../src/commands/build')).build,
  'export': async () => (await import('../../src/commands/archive')).exportPack,
  'init-tests': async () => (await import('../../src/commands/init-tests')).initTests,
  'facade-report': async () => (await import('../../src/commands/facade-report')).facadeReport,
} satisfies Record<string, () => Promise<(args: string[]) => unknown>>;

/**
 * Registered once per process, as `bin/apack.mjs` does for a spawn: the CLI loads a pack's TypeScript
 * by dynamic import, and those files sit in a temp dir outside vitest's root, where its own transform
 * does not reach.
 */
let tsxRegistered = false;
async function registerTsx(): Promise<void> {
  if (tsxRegistered) return;
  (await import('tsx/esm/api')).register();
  tsxRegistered = true;
}

/**
 * Runs a CLI command in this process against `dir`, returning `{ code, output }` as `runCommand` does so a
 * call site reads the same either way. For the spawns that exist to *produce* something — a built pack, a
 * scaffold — where the process boundary is cost rather than coverage; a test asserting on an exit code,
 * stderr or argv runs the real process through `runCommand` (`_support/run-command.ts`), because that is
 * what it is testing.
 *
 * Measured on a minimal pack: three builds cost 14.1s spawned and 7.4s here, because esbuild, vite and
 * tailwind load once for the file instead of once per build.
 *
 * Two pieces of global state make this safe only for tests that run one at a time, which is every test
 * in this suite — vitest gives each file its own forked process and runs its tests in sequence:
 *
 * - the commands read `process.cwd()` rather than taking a root, so this chdirs and restores;
 * - a command that fails calls `process.exit`, which would take the worker with it, so that is swapped
 *   for a throw and reported as `code` instead.
 */
export async function callCli(dir: string, command: keyof typeof COMMANDS, args: string[] = []): Promise<{ code: number; output: string }> {
  await registerTsx();
  const chunks: string[] = [];
  const cwd = process.cwd();
  const console_ = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  const exit = process.exit;
  const capture = (...parts: unknown[]) => { chunks.push(`${parts.map(String).join(' ')}\n`); };
  class Exited extends Error { constructor(readonly code: number) { super(`process.exit(${code})`); } }
  try {
    process.chdir(dir);
    Object.assign(console, { log: capture, error: capture, warn: capture, info: capture });
    process.exit = ((code?: number) => { throw new Exited(code ?? 0); }) as typeof process.exit;
    await (await COMMANDS[command]())(args);
    return { code: 0, output: chunks.join('') };
  } catch (err) {
    return { code: err instanceof Exited ? err.code : 1, output: `${chunks.join('')}${err instanceof Exited ? '' : String(err)}` };
  } finally {
    process.chdir(cwd);
    Object.assign(console, console_);
    process.exit = exit;
    // Receive runner updates between completed compiler operations, after restoring process globals.
    await new Promise<void>(resolve => { setImmediate(resolve); });
  }
}

/**
 * Typechecks a pack with the TypeScript API instead of a `tsc` spawn, returning `{ code, output }`.
 * The same program the compiler would build, from the same tsconfig — `tsc -p` and `tsc --noEmit` in
 * the pack both reduce to this — without paying process start and lib loading each time, and reusing
 * those lib files across calls within a file.
 *
 * `facade-typing.integration.spec.ts` already reads diagnostics this way (`packDeclarationDiagnostics`); this is
 * the same move for the call sites that only wanted a pass or fail.
 */
export async function typecheckPack(dir: string, tsconfigName = 'tsconfig.json'): Promise<{ code: number; output: string }> {
  const ts = await import('typescript');
  const configPath = path.join(dir, tsconfigName);
  const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d: import('typescript').Diagnostic) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, ' ')); } };
  const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  if (!config) return { code: 1, output: `could not read ${configPath}` };
  const program = ts.createProgram({ rootNames: config.fileNames, options: { ...config.options, noEmit: true } });
  const diagnostics = [
    ...config.errors,
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ];
  const output = diagnostics.map((d) => {
    const where = d.file && d.start !== undefined
      ? `${path.relative(dir, d.file.fileName)}(${d.file.getLineAndCharacterOfPosition(d.start).line + 1})`
      : '';
    return `${where}: error TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
  }).join('\n');
  await new Promise<void>(resolve => { setImmediate(resolve); });
  return { code: diagnostics.length > 0 ? 1 : 0, output };
}

/** Writes a tree of files under `dir`, creating directories as needed */
export function write(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content));
  }
}

/** A pack's package.json: the `#generated/*` subpath imports are what its generated code is reached by */
export const packageJson = (name: string) =>
  JSON.stringify({ name, type: 'module', imports: { '#generated/*': './src/__generated__/*' } });

/**
 * A pack's tsconfig: the scaffold's, unchanged, so a test pack compiles the same way a scaffolded one does.
 *
 * It used to add `customConditions: ['@apackdev/source']`, on the stated grounds that these packs sit inside the
 * checkout and resolve the workspace packages. They do sit inside it, but they never needed to read its source:
 * dropping the condition left all 15 integration specs and their 191 cases green (2026-09-27). What it bought
 * was the asymmetry the root CLAUDE.md warns about — these packs typechecked against workspace `src/` while
 * `apack pack build` bundled them from `dist`, because esbuild has no notion of the condition. So the fixture was
 * the one place in the repo where a pack compiled unlike every pack author's, which is what the
 * `source-resolution` pack rule now refuses.
 */
export const tsconfig = JSON.stringify(PACK_TSCONFIG);

/** Writes a pack and links it to the given `node_modules`, so `apack pack build` can run in it */
export function preparePack(parent: string, name: string, files: Record<string, string>, modules: string): string {
  return packFixture({ at: path.join(parent, name), files, nodeModules: modules });
}

/** Builds a prepared pack, throwing with the CLI's output when it fails */
export async function buildPack(dir: string, name = path.basename(dir)): Promise<string> {
  const build = await callCli(dir, 'build');
  if (build.code !== 0) throw new Error(`apack pack build failed in ${name}:\n${build.output}`);
  return build.output;
}

/**
 * The bare specifiers a built frontend bundle left for the host to resolve.
 *
 * This is what a bundle now says about sharing, sharing being resolution: a specifier here is one the
 * document's import map has to name, and one that is *absent* was inlined into the pack. Read with the
 * module lexer rather than from Rollup's graph, because what the browser links against is this text.
 */
export async function bundleExternals(file: string): Promise<string[]> {
  const { init, parse } = await import('es-module-lexer');
  await init;
  const code = fs.readFileSync(file, 'utf-8');
  const [imports] = parse(code, file);
  return [...new Set(imports.map((i) => i.n).filter((n): n is string => n !== undefined))].sort();
}
