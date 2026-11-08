/**
 * Where a test file starts a subprocess, read from its syntax tree.
 *
 * **The question is what a file can do, not what its arguments say.** The check this replaces asked whether
 * a call's argument text matched `/\b(tsc|vue-tsc|TSC_VERSIONS)\b/` and whether its callee was in a
 * hand-written list of spawner names. Both halves were wrong on the tree they shipped against: it reported
 * three spawning specs where there are twelve, and the one it caught was the cheapest of them. It missed a
 * spec running `node <CLI> build` twice (no compiler in the argument text), one calling
 * `spawnSync(command, …)` through a variable (nothing to match), and `execFile`, which the list omitted
 * while carrying both other sync/async pairs.
 *
 * So nothing here is named. The names come from the `child_process` import in each file, however it is
 * spelled, and a spawn is a call of one of them. Hoisting a binary path into a const, renaming a helper and
 * reaching for a different `child_process` export all stop mattering, because none of them is what is read.
 *
 * **A file is named for holding a call, not for reaching one.** `tests/_support/pack-builds.ts` exports a
 * `run` that spawns, so it is named once rather than fanning out to every spec that imports it — measured,
 * that fan-out over-collects, because most importers want the in-process `callCli` and never spawn. The
 * cost is that a spec calling `run` is not itself named; what it imports is, which is where the call is.
 *
 * Three things it does not see, none of them present in this tree, all cheaper to record than to detect:
 * `require('child_process')`, a dynamic `await import('node:child_process')`, and a re-export
 * (`export { spawn } from 'node:child_process'`), whose caller binds the name from somewhere else.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { INTEGRATION_SUITES, NATIVE_SUITES } from './chain-steps.ts';
import { importedCallsIn } from './imported-calls.ts';
import { reachableFrom } from './module-graph.ts';
import { halfOfPath } from './spec-halves.ts';

/** However the module is spelled */
const CHILD_PROCESS = new Set(['node:child_process', 'child_process']);


/**
 * The spawn calls in one file, each as the name it was called through (`execFileSync`, `cp.spawn`).
 *
 * Empty for a file that imports `child_process` and never calls it, which is the honest answer: an import
 * is not a subprocess, and a file that only re-exports a type from it is not a spawner.
 */
export const spawnCallsIn = (absFile: string): string[] =>
  [...importedCallsIn(absFile, { fromModules: CHILD_PROCESS }), ...indirectSpawnCallsIn(absFile)];

/** The test-support runner for process trees (`apack-cli tests/_support/run-command.ts`), however it is imported */
const RUN_COMMAND = /(^|\/)run-command(\.ts)?$/;
/** Where `execFileWhileWorking` comes from: `promisify(execFile)` bounded by progress, the one a spec reaches for */
const PROCESS_PROGRESS = /(^@apackdev\/host\/build\/process-progress|(^|\/)process-progress(\.ts)?)$/;

/**
 * The spawns a file makes without calling a `child_process` export by name: through `promisify(execFile)` — bound
 * to a const or called inline — through `execFileWhileWorking`, its progress-bounded form, called by its name or a
 * const bound to it, and through `runCommand`. They are how the integration and native halves start a process,
 * since a synchronous call is refused there, so a count that missed them would read as no spawning.
 */
function indirectSpawnCallsIn(absFile: string): string[] {
  const source = ts.createSourceFile(absFile, fs.readFileSync(absFile, 'utf-8'), ts.ScriptTarget.Latest, true);
  const fromChildProcess = new Set<string>();
  const runners = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    const specifier = statement.moduleSpecifier.text;
    for (const element of bindings.elements) {
      if (CHILD_PROCESS.has(specifier)) fromChildProcess.add(element.name.text);
      else if (RUN_COMMAND.test(specifier) && (element.propertyName ?? element.name).text === 'runCommand') runners.add(element.name.text);
      else if (PROCESS_PROGRESS.test(specifier) && (element.propertyName ?? element.name).text === 'execFileWhileWorking') runners.add(element.name.text);
    }
  }
  const promisified = (node: ts.Node): boolean => ts.isCallExpression(node)
    && (ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '') === 'promisify'
    && node.arguments.length === 1 && ts.isIdentifier(node.arguments[0]!) && fromChildProcess.has(node.arguments[0].text);
  const bound = new Set<string>();
  const calls: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined
      && (promisified(node.initializer) || (ts.isIdentifier(node.initializer) && runners.has(node.initializer.text)))) {
      bound.add(node.name.text);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (promisified(callee)) calls.push('promisify');
      else if (ts.isIdentifier(callee) && (bound.has(callee.text) || runners.has(callee.text))) calls.push(callee.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

/** Every `.ts` under a directory — the whole tree, not only its specs: a support module is where a spawn hides */
export function tsFilesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? tsFilesUnder(full) : entry.name.endsWith('.ts') ? [full] : [];
  });
}

export { reachableFrom };

/** The `tests/` trees of the suites with an expensive half, integration or native, from their one definitions */
export const expensiveSuiteTests = (root: string): string[] =>
  [...new Set([...INTEGRATION_SUITES, ...NATIVE_SUITES])].map((suite) => path.join(root, 'packages', suite.dir, 'tests'));

/**
 * What the integration and native pools load: their specs, and every module of those trees they reach. One
 * population for the subprocess inventory and for the rule refusing synchronous spawns, so the two cannot
 * disagree about which files run in those pools.
 */
export const loadedByThePools = (root: string): string[] => {
  const trees = expensiveSuiteTests(root);
  return reachableFrom(trees.flatMap((dir) => tsFilesUnder(dir)).filter((file) => halfOfPath(file) !== 'fast'), trees);
};

/**
 * The synchronous `child_process` exports a file imports (`execFileSync`, `spawnSync`, `execSync`), by their
 * exported name — so an alias cannot hide one. Asked of the import rather than the calls, because importing
 * one is already the decision to block the worker.
 */
export function syncSpawnImportsIn(absFile: string): string[] {
  const source = ts.createSourceFile(absFile, fs.readFileSync(absFile, 'utf-8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || !CHILD_PROCESS.has(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const exported = (element.propertyName ?? element.name).text;
      if (exported.endsWith('Sync')) found.push(exported);
    }
  }
  return found;
}

/** A file that starts a subprocess, and how */
export interface SpawnSite {
  /** Repo-relative, so it can be compared against a recorded list */
  readonly file: string;
  /** The names the calls went through, deduped and sorted */
  readonly through: readonly string[];
  /** How many call sites, which is what creeps */
  readonly count: number;
}

/**
 * Which of the given files start a subprocess.
 *
 * Takes the files rather than deriving them, so a caller can run it over a population of its own — which is
 * how the rule gets a mutation case that changes the *input* instead of the expectation it compares against.
 */
export function spawnSitesIn(files: readonly string[], root: string): SpawnSite[] {
  return files
    .map((file) => ({ file, calls: spawnCallsIn(file) }))
    .filter(({ calls }) => calls.length > 0)
    .map(({ file, calls }) => ({
      file: path.relative(root, file),
      through: [...new Set(calls)].sort(),
      count: calls.length,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
