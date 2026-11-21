/**
 * The source-condition rule: which workspace configs must declare `@apackdev/source`, and which must not.
 *
 * The definition, not the command — `scripts/check-import-specifiers.ts` is the command over it, the same
 * split as `scripts/spec.ts` over `scripts/lib/spec-plan.ts`. It is one rule with private machinery no other
 * rule calls into: a walk of the tree, a config reader that follows `extends` and `projects`, and the two
 * exception tables. Nothing here is reachable from another rule, and nothing here reaches one.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { SOURCE_CONDITION } from '@apackdev/host/build/source-resolution';
import { readSource } from '../../packages/apack-cli/src/build/pack-sources.ts';
import { CLI_TEMPLATE_PACK, readJsonFile, repoRelative, repoRoot, SKIPPED_DIRS } from './import-populations.ts';

/**
 * Config files that compile or bundle workspace source. A tsconfig separates its name with a dot or
 * a dash (`tsconfig.build.json`, `tsconfig-build.json`); a bundler config may carry a suffix on
 * either side of `config` (`vitest.node.config.ts`, `vite.config.prod.ts`, `rollup-defs.config.mjs`).
 */
const CONFIG_FILE = /^(?:tsconfig(?:[.-][\w.-]+)?\.json|(?:vite|vitest|tsup|tsdown|rollup|esbuild|build)(?:[.-][\w.-]+)?\.config(?:\.[\w.-]+)?\.[cm]?[jt]s)$/;
/** Files a config compiles or bundles. Declarations included: tsc resolves their imports too */
const CODE_FILE = /\.(?:[cm]?[jt]sx?|vue)$/;

const CONFIG_EXTENSIONS = ['', '.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];
/**
 * Vitest options that name files the config runs itself. A config with one of them compiles code of
 * its own, so its `projects` don't excuse it from declaring the condition.
 */
const TEST_FILE_OPTIONS = ['include', 'includeSource', 'dir', 'root', 'setupFiles', 'globalSetup', 'benchmark', 'typecheck'];

/**
 * Pack configs that declare the `@apackdev/source` condition on purpose, with the reason each does.
 *
 * The rule this excepts: a pack resolves the `@apackdev` packages' published `dist`, the one layout a pack
 * author ever has. A pack config that declares the condition compiles against this checkout's source
 * instead, so it builds something no pack author can reproduce.
 *
 * **Try moving the file first.** What this is for is a config that belongs to a pack but is run by a
 * host build: a Vite config for a built-in pack's frontend that the renderer runs, or a tsconfig the
 * app's build extends to compile that pack's sources. Both are host code by role and pack code only by
 * location. Putting such a file in `packages/renderer/` and naming it after the pack costs nothing but
 * distance from the code it configures — so add a row only when moving it is genuinely not possible.
 *
 * **Never to make a pack's own build or test run work.** That pack then builds unlike every pack
 * author's, which is the failure this rule exists to prevent. A pack build that needs source is one
 * whose `dist` is stale: run `npm run packages:ensure`. Same for a "canary" pack compiled against SDK
 * source to catch breaking changes early — it reports on a world no pack author lives in, and
 * `npm run typecheck:sdk` and the `api:check` reports already cover that surface against the real
 * declarations.
 *
 * **Keep it much smaller than `RESOLVES_DIST_BY_DESIGN`.** The two are not mirror images. An exception
 * there resolves `dist`, the layout every consumer has, so a wrong entry costs a stale build and surfaces
 * as a type error. An exception here resolves this checkout's source, so a wrong entry costs a build
 * nobody outside this checkout can reproduce — and nothing notices, because
 * `types-bundler-determinism.integration.spec.ts` compares a synthetic fixture pack against the published tarballs,
 * never the packs in this repository. So a row excepting a pack's *build* owes a test that builds that
 * pack both ways and compares the output; a row for a host config that merely sits in the tree owes
 * nothing, having never been a pack build.
 */
export const DECLARES_SOURCE_BY_DESIGN = new Map<string, string>([
  // Empty on purpose: every case so far has been better served by moving the file out of the pack tree.
  // A spec asserts it stays empty, so the first row costs a deliberate edit rather than an absent-minded one.
  //
  // If you are an agent and the work in front of you seems to need a row here: stop and raise it with the
  // user. Adding one, deleting the spec that keeps this empty, or loosening the rule around it are their
  // calls, not yours — and the answer is usually to move the file instead.
]);

/**
 * Configs that resolve a built `dist` on purpose, with the reason. Every other config that compiles
 * or bundles code importing a source-condition package must declare the condition, so a new one
 * either declares it or is listed here.
 */
export const RESOLVES_DIST_BY_DESIGN = new Map<string, string>([
  // API Extractor reads the .d.ts rollup of a package's dependencies, so they must resolve to built
  // declarations; with the source condition tsc would analyse the dependency's .ts instead and report
  // diagnostics for source the report never covers.
  ['packages/apack-ui/tsconfig.api-extractor.json', 'API Extractor analyses .d.ts: @apackdev/sdk resolves to its built declarations'],
  ['packages/apack-testing/tsconfig.api-extractor.json', 'API Extractor analyses .d.ts: @apackdev/sdk and /host resolve to their built declarations'],
  // tsdown keeps every dependency and peer external (deps.neverBundle), so it never resolves
  // @apackdev/sdk at all; vue-tsc emits the declarations under tsconfig.package.json, which declares it.
  ['packages/apack-ui/tsdown.config.ts', 'every @apackdev dependency stays external (deps.neverBundle), so nothing is resolved'],
]);

function conditionOption(file: string): string {
  const name = path.basename(file);
  if (name.endsWith('.json')) return 'compilerOptions.customConditions';
  return /^(?:tsup|tsdown|rollup|esbuild|build)[.-]/.test(name) ? 'conditions' : 'resolve.conditions (and ssr.resolve.conditions)';
}

/** The workspace packages whose exports resolve TypeScript source under the condition */
export function sourceConditionPackages(root = repoRoot): string[] {
  const dir = path.join(root, 'packages');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'package.json')))
    .map((entry) => readJsonFile<{ name?: string; exports?: unknown }>(path.join(dir, entry.name, 'package.json')))
    .filter((manifest) => manifest.name !== undefined && JSON.stringify(manifest.exports ?? {}).includes(`"${SOURCE_CONDITION}"`))
    .map((manifest) => manifest.name!);
}

/** A per-run cache: each call to the check builds its own, so a temp tree is never read as stale */
function cached<T>(store: Map<string, T>, key: string, compute: () => T): T {
  const hit = store.get(key);
  if (hit !== undefined) return hit;
  const value = compute();
  store.set(key, value);
  return value;
}

/** What the source-condition check reads, cached per run */
interface ConditionScan {
  packages: readonly string[];
  configs: string[];
  code: string[];
  /** Every directory holding an `apack.json` */
  packs: string[];
  /** Whether a file imports one of `packages`, by absolute path */
  imports: Map<string, boolean>;
  tsconfigs: Map<string, ts.ParsedCommandLine>;
  sources: Map<string, ts.SourceFile>;
}

/**
 * Every config file and every code file under `dir`, collected into `scan`. Symlinked directories are
 * descended (a `Dirent` never reports one as a directory, so code reachable only through a symlinked
 * `src` would be invisible). `ancestors` holds the real path of every directory on the way in, so a
 * link back to one of them ends the walk at once; a real directory reached by two different paths is
 * still walked under each, since that is where the configs above it look for code.
 */
function walkTree(dir: string, scan: ConditionScan, ancestors: Set<string>): void {
  let real: string;
  try {
    real = fs.realpathSync(dir);
  } catch {
    return;
  }
  if (ancestors.has(real)) return;
  ancestors.add(real);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const what = entry.isSymbolicLink() ? fs.statSync(full, { throwIfNoEntry: false }) : entry;
    if (what?.isDirectory()) {
      if (!SKIPPED_DIRS.test(entry.name)) walkTree(full, scan, ancestors);
    } else if (what?.isFile()) {
      // A config is code too: a tsconfig that lists `vitest.config.ts` compiles it
      if (CONFIG_FILE.test(entry.name)) scan.configs.push(full);
      if (CODE_FILE.test(entry.name)) scan.code.push(full);
      // A directory with a manifest is a pack, and a pack resolves the packages' published dist
      if (entry.name === 'apack.json') scan.packs.push(dir);
    }
  }
  ancestors.delete(real);
}

function importsSourcePackage(file: string, scan: ConditionScan): boolean {
  return cached(scan.imports, file, () => {
    if (!CODE_FILE.test(file) || !fs.existsSync(file)) return false;
    const code = fs.readFileSync(file, 'utf-8');
    // A file that never spells a package's name imports none of them: skip the parse
    if (!scan.packages.some((pkg) => code.includes(pkg))) return false;
    const matches = (text: string) => scan.packages.some((pkg) => text === pkg || text.startsWith(`${pkg}/`));
    return readSource(file).specifiers.some(({ text }) => matches(text));
  });
}

/** The code a config compiles or bundles: nothing, exactly these files, or everything under these directories */
type ConfigScope =
  | { kind: 'none' }
  | { kind: 'files'; files: string[] }
  /** `hint` says why the scope had to be widened to a directory, and is reported with the problem */
  | { kind: 'trees'; dirs: string[]; hint?: string };

function compilesImportingCode(scope: ConfigScope, scan: ConditionScan): boolean {
  if (scope.kind === 'none') return false;
  if (scope.kind === 'files') return scope.files.some((file) => importsSourcePackage(file, scan));
  return scan.code.some((file) => scope.dirs.some((dir) => file.startsWith(dir + path.sep)) && importsSourcePackage(file, scan));
}

/** A tsconfig with its `extends` chain resolved, the way tsc reads it */
function parsedTsconfig(file: string, scan: ConditionScan): ts.ParsedCommandLine {
  return cached(scan.tsconfigs, file, () => {
    const host: ts.ParseConfigFileHost = {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      readDirectory: ts.sys.readDirectory,
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      getCurrentDirectory: () => path.dirname(file),
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
      },
    };
    const parsed = ts.getParsedCommandLineOfConfigFile(file, {}, host);
    if (parsed === undefined) throw new Error(`${file}: could not be read as a tsconfig`);
    return parsed;
  });
}

function configSource(file: string, scan: ConditionScan): ts.SourceFile {
  return cached(scan.sources, file, () => ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true));
}

/** An expression with its parentheses and its `as`/`satisfies` assertions stripped */
function unwrap(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)
    ? unwrap(expression.expression) : expression;
}

/** A property name as written, for identifiers and string literals alike */
function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

function ownProperty(object: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((p) => p.name !== undefined && propertyName(p.name) === name);
}

/** The object a config expression yields, through wrappers, `defineConfig(…)` and the function that returns it */
function configObjectOf(raw: ts.Expression, found: ts.ObjectLiteralExpression[], seen: Set<ts.Node>): void {
  const expression = unwrap(raw);
  if (seen.has(expression)) return;
  seen.add(expression);
  if (ts.isObjectLiteralExpression(expression)) found.push(expression);
  else if (ts.isCallExpression(expression)) {
    for (const argument of expression.arguments) configObjectOf(argument, found, seen);
  } else if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    if (ts.isBlock(expression.body)) {
      const returns = (node: ts.Node): void => {
        if (ts.isReturnStatement(node) && node.expression) configObjectOf(node.expression, found, seen);
        // A nested function returns something else
        if (!ts.isFunctionLike(node) || node === expression) node.forEachChild(returns);
      };
      expression.body.forEachChild(returns);
    } else configObjectOf(expression.body, found, seen);
  }
}

/**
 * The object literals that carry a config's own options: what the file exports by default (through
 * `defineConfig(…)`, `mergeConfig(…)` and a function that returns it), any object with a `test`
 * option, and that `test` option itself.
 */
function configObjects(source: ts.SourceFile): ts.ObjectLiteralExpression[] {
  const found: ts.ObjectLiteralExpression[] = [];
  const seen = new Set<ts.Node>();
  const walk = (node: ts.Node): void => {
    if (ts.isExportAssignment(node) && !node.isExportEquals) configObjectOf(node.expression, found, seen);
    if (ts.isObjectLiteralExpression(node)) {
      const test = ownProperty(node, 'test');
      if (test !== undefined) {
        if (!found.includes(node)) found.push(node);
        if (ts.isPropertyAssignment(test) && ts.isObjectLiteralExpression(test.initializer) && !found.includes(test.initializer)) {
          found.push(test.initializer);
        }
      }
    }
    node.forEachChild(walk);
  };
  walk(source);
  return found;
}

/**
 * A Vitest config that compiles nothing of its own: a `test.projects` (or the older `test.workspace`)
 * that names other configs by path, each of which declares its own conditions, environment and setup.
 * A `projects` elsewhere in the file is somebody else's option — `vite-tsconfig-paths({ projects })`
 * takes one — and a `test` that also names files of its own (`include`, `setupFiles`, …) compiles
 * them under this config, so neither exempts it.
 */
function projectListScope(file: string, scan: ConditionScan): ConfigScope | undefined {
  if (!/^(?:vite|vitest)[.-]/.test(path.basename(file))) return undefined;
  const source = configSource(file, scan);
  for (const object of configObjects(source)) {
    const list = ownProperty(object, 'projects') ?? ownProperty(object, 'workspace');
    if (list === undefined) continue;
    if (TEST_FILE_OPTIONS.some((option) => ownProperty(object, option) !== undefined)) return undefined;
    const value = ts.isPropertyAssignment(list) ? list.initializer : ts.isShorthandPropertyAssignment(list) ? list.name : undefined;
    // A path per project, or the older `workspace: './vitest.workspace.ts'`: each config resolves for itself
    if (value !== undefined && namesPaths(value, source, new Set())) return { kind: 'none' };
    // Built at run time: what it compiles can't be read here, so say so rather than guess
    return {
      kind: 'trees',
      dirs: [path.dirname(file)],
      hint: `its ${propertyName(list.name!)!} isn't a literal list of project paths, so what this config compiles can't be read here — name each project by path, declare the condition anyway, or list it in RESOLVES_DIST_BY_DESIGN`,
    };
  }
  return undefined;
}

/** Whether an expression is a non-empty list of string literals, or an identifier the file declares as one */
function namesPaths(raw: ts.Expression, source: ts.SourceFile, seen: Set<ts.Node>): boolean {
  const value = unwrap(raw);
  if (seen.has(value)) return false;
  seen.add(value);
  if (ts.isStringLiteralLike(value)) return true;
  if (ts.isArrayLiteralExpression(value)) return value.elements.length > 0 && value.elements.every(ts.isStringLiteralLike);
  if (ts.isIdentifier(value)) {
    const declared = declarationsOf(source, value.text);
    return declared.length === 1 && namesPaths(declared[0], source, seen);
  }
  return false;
}

/** A `root` a config sets on itself or on its `test` option, resolved against the config's directory */
function configuredRoots(file: string, scan: ConditionScan): string[] {
  return configObjects(configSource(file, scan)).flatMap((object) => {
    const root = ownProperty(object, 'root');
    return root !== undefined && ts.isPropertyAssignment(root) && ts.isStringLiteralLike(root.initializer)
      ? [path.resolve(path.dirname(file), root.initializer.text)] : [];
  });
}

/**
 * What a config compiles or bundles. A tsconfig's `files` and `include` are resolved the way tsc
 * resolves them, so a config that reaches outside its own directory is seen and one that covers a
 * sibling's code only is not blamed for it. A bundler config covers its own directory and any `root`
 * it names — a union, never a narrowing, since its entry points may sit outside that root.
 */
function configScope(file: string, scan: ConditionScan): ConfigScope {
  const dir = path.dirname(file);
  if (!file.endsWith('.json')) {
    return projectListScope(file, scan) ?? { kind: 'trees', dirs: [dir, ...configuredRoots(file, scan)] };
  }
  const parsed = parsedTsconfig(file, scan);
  const raw = (parsed.raw ?? {}) as { files?: unknown; include?: unknown };
  const emptyList = (value: unknown) => Array.isArray(value) && value.length === 0;
  // A solution file (`files: []` with only references) and an explicit `include: []` compile nothing.
  // `files: []` beside an `include` still compiles that include, so it is not one of them.
  const listsNothing = raw.include === undefined
    ? emptyList(raw.files)
    : emptyList(raw.include) && (raw.files === undefined || emptyList(raw.files));
  if (listsNothing) return { kind: 'none' };
  if (parsed.fileNames.length > 0) return { kind: 'files', files: parsed.fileNames };
  // Its specs name files that aren't on disk in this state (a generated .temp/api-types, an unbuilt
  // dist). Fall back to the directory it sits in rather than read it as compiling nothing.
  return { kind: 'trees', dirs: [dir] };
}

/** A relative config import resolved to the JavaScript or TypeScript file it names, or undefined */
function resolveConfig(from: string, specifier: string): string | undefined {
  if (!/^\.\.?\//.test(specifier)) return undefined;
  const base = path.resolve(path.dirname(from), specifier);
  return CONFIG_EXTENSIONS.map((ext) => `${base}${ext}`)
    .find((candidate) => /\.[cm]?[jt]s$/.test(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

/** Whether a config declares the condition: yes, no, or an option this check can't read */
type Verdict = true | false | { unreadable: string };

/** True when the verdicts carry the condition (all of them with `every`, otherwise any); else the first unreadable one */
function combine(verdicts: Verdict[], every = false): Verdict {
  if (every ? verdicts.every((v) => v === true) : verdicts.some((v) => v === true)) return true;
  return verdicts.find((v) => v !== true && v !== false) ?? false;
}

/** Everything `pick` finds in the file's syntax tree */
function collect<T>(source: ts.SourceFile, pick: (node: ts.Node) => T | undefined): T[] {
  const found: T[] = [];
  const walk = (node: ts.Node): void => {
    const value = pick(node);
    if (value !== undefined) found.push(value);
    node.forEachChild(walk);
  };
  walk(source);
  return found;
}

/**
 * Every expression a config assigns to a `conditions` option: `resolve: { conditions: [...] }`,
 * the shorthand `{ conditions }`, and `esbuildOptions.conditions = [...]`.
 */
function conditionValues(source: ts.SourceFile): ts.Expression[] {
  return collect(source, (node) => {
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'conditions') return node.initializer;
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'conditions') return node.name;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'conditions') return node.right;
    return undefined;
  });
}

/** The initializers of every `const`/`let` declaration of `name` in the file */
function declarationsOf(source: ts.SourceFile, name: string): ts.Expression[] {
  return collect(source, (node) => (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name
    ? node.initializer : undefined));
}

/** Whether an expression yields a condition list holding the source condition, or can't be read here */
function yieldsCondition(raw: ts.Expression, source: ts.SourceFile, seen: Set<ts.Node>): Verdict {
  const value = unwrap(raw);
  if (seen.has(value)) return false;
  seen.add(value);
  if (ts.isStringLiteralLike(value)) return value.text === SOURCE_CONDITION;
  if (ts.isArrayLiteralExpression(value)) {
    // An array says what it holds: only its spreads can hide the condition
    if (value.elements.some((el) => ts.isStringLiteralLike(el) && el.text === SOURCE_CONDITION)) return true;
    return combine(value.elements.filter(ts.isSpreadElement).map((el) => yieldsCondition(el.expression, source, seen)));
  }
  if (ts.isIdentifier(value)) {
    const declared = declarationsOf(source, value.text);
    if (declared.length === 0) return { unreadable: `the condition list ${value.text} comes from outside this file` };
    return combine(declared.map((init) => yieldsCondition(init, source, seen)));
  }
  // A computed list says nothing either way: every config that needs the condition names it outright
  if (ts.isCallExpression(value)) {
    const callee = ts.isIdentifier(value.expression) ? value.expression.text
      : ts.isPropertyAccessExpression(value.expression) ? value.expression.name.text : undefined;
    return { unreadable: `its condition list is built by ${callee ?? 'a call'}()` };
  }
  // Both branches of a conditional must carry it: one that doesn't resolves dist
  if (ts.isConditionalExpression(value)) {
    return combine([value.whenTrue, value.whenFalse].map((branch) => yieldsCondition(branch, source, seen)), true);
  }
  return { unreadable: 'its condition list is an expression this check cannot read' };
}

/**
 * Whether a config declares the source condition. A tsconfig is read the way tsc reads it, so an
 * `extends` chain of any shape — a relative path, a file named anything, a package base — counts.
 * A bundler config declares it in a `conditions` option; only when it sets none does a config it is
 * built from (`mergeConfig(viteConfig, …)`) decide, since its own `conditions` replace what it merged.
 */
function declaresCondition(file: string, scan: ConditionScan, seen = new Set<string>()): Verdict {
  if (seen.has(file) || !fs.existsSync(file)) return false;
  seen.add(file);
  if (file.endsWith('.json')) {
    return parsedTsconfig(file, scan).options.customConditions?.includes(SOURCE_CONDITION) ?? false;
  }
  const source = configSource(file, scan);
  const values = conditionValues(source);
  if (values.length > 0) return combine(values.map((value) => yieldsCondition(value, source, new Set())));
  let unreadable: Verdict | undefined;
  // The same file the parse above came from, through the shared reader so it is parsed once per process
  for (const { text } of readSource(file).specifiers.filter(({ text }) => /^\.\.?\//.test(text))) {
    const resolved = resolveConfig(file, text);
    if (resolved === undefined) continue;
    const verdict = declaresCondition(resolved, scan, seen);
    if (verdict === true) return true;
    if (verdict !== false) unreadable ??= verdict;
  }
  return unreadable ?? false;
}

/**
 * `file: what` for each workspace config that compiles or bundles code importing a source-condition
 * package and neither declares the condition nor is listed in `RESOLVES_DIST_BY_DESIGN`; without it the
 * config silently reads a stale or absent `dist`. A config whose conditions or project list can't be
 * read statically is reported too, with what to change: a rule that guesses is a rule that lets the
 * next one through. An exception that no longer applies is reported too, so the list doesn't outlive
 * its reason.
 *
 * **It reads config text, where `apack-cli/src/build/pack-resolution.ts` asks the resolver, and that is
 * settled rather than unfinished.** Three measurements, 2026-09-27:
 *
 * - **Nothing would be gained.** Of 29 tsconfigs, every one that reaches a source package's `src` does it
 *   through `customConditions` — none through a `paths` entry, an `extends` chain or a project reference.
 *   (A probe saying otherwise counted `@apackdev/sdk` resolved from inside `packages/apack-sdk`, which lands
 *   in its own `src` whatever the conditions say: a package resolved from within itself is not this rule's
 *   subject.)
 * - **Something would be lost.** Resolution only answers against the filesystem as it is. On a checkout
 *   before `npm run packages:ensure` a config *missing* the condition resolves to nothing at all, so a
 *   resolution-based rule would report nothing — silence exactly where this one reports the problem. Reading
 *   text needs no build, and this check is run standalone as often as through `typecheck`.
 * - **Half the population cannot be resolved at any price.** A Vitest config's `resolve.conditions` has no
 *   resolved value until the run, and by then the pack's suite has already passed against workspace source
 *   (`pack-resolution.ts` records the same thing from the other side). Driving Vite's resolver needs two
 *   `@experimental` APIs, a client-versus-ssr choice per config, and importing configs that create temp
 *   directories, mutate `process.env` from a `.env`, or import `electron`.
 *
 * So the split with `pack-resolution.ts` is by population and by what each population can be asked, not by
 * subject. Revisit if a config ever reaches source another way — that is the condition, and it is checkable
 * with the probe above.
 */
export function findMissingSourceConditions(
  root = repoRoot,
  exceptions = RESOLVES_DIST_BY_DESIGN,
  packExceptions = DECLARES_SOURCE_BY_DESIGN,
): string[] {
  const scan: ConditionScan = {
    packages: sourceConditionPackages(root),
    configs: [], code: [], packs: [], imports: new Map(), tsconfigs: new Map(), sources: new Map(),
  };
  walkTree(root, scan, new Set());
  // The scaffold's templates are a pack with no manifest — `apack.json` is built in code, from an object with
  // computed keys — so the walk cannot recognise it, and its `vitest.config.ts` would be read as one of the
  // repo's own and told to declare the source condition. It is the pack every pack author starts from, so the
  // rule that applies is the pack one: declare nothing.
  scan.packs.push(path.join(root, CLI_TEMPLATE_PACK));
  const problems: string[] = [];
  const applied = new Set<string>();
  const packApplied = new Set<string>();
  const inPack = (file: string) => scan.packs.some((pack) => file.startsWith(pack + path.sep));
  for (const file of scan.configs.sort()) {
    const relative = repoRelative(root, file);
    const verdict = declaresCondition(file, scan);
    // A pack compiles the packages' published dist, the one layout a pack author has, so its configs
    // declare nothing. The rule is the other way round for the repo's own code, below.
    if (inPack(file)) {
      if (verdict === false) continue;
      if (packExceptions.has(relative)) { packApplied.add(relative); continue; }
      problems.push(`${relative}: a pack resolves the @apackdev packages' published dist, so it must not declare "${SOURCE_CONDITION}" in ${conditionOption(file)}`
        + '; move a host-side config out of the pack tree, or add it to DECLARES_SOURCE_BY_DESIGN saying why it belongs there');
      continue;
    }
    const scope = configScope(file, scan);
    if (verdict === true || !compilesImportingCode(scope, scan)) continue;
    if (exceptions.has(relative)) { applied.add(relative); continue; }
    const notes = [verdict === false ? undefined : verdict.unreadable, scope.kind === 'trees' ? scope.hint : undefined];
    problems.push(`${relative}: needs ${conditionOption(file)} with "${SOURCE_CONDITION}", or an entry in RESOLVES_DIST_BY_DESIGN saying why it resolves dist`
      + notes.filter((note) => note !== undefined).map((note) => `; ${note}`).join(''));
  }
  const present = new Set(scan.configs.map((file) => repoRelative(root, file)));
  for (const [relative, reason] of exceptions) {
    if (!applied.has(relative)) {
      problems.push(`${relative}: listed in RESOLVES_DIST_BY_DESIGN (${reason}) but ${present.has(relative) ? 'it already declares the condition or compiles no such code' : 'the config is gone'}`);
    }
  }
  // An exception that stopped applying is itself a problem: the reason it records is no longer true of
  // anything, and a row nobody revisits is how a table like this grows past what it can justify
  for (const [relative, reason] of packExceptions) {
    if (!packApplied.has(relative)) {
      problems.push(`${relative}: listed in DECLARES_SOURCE_BY_DESIGN (${reason}) but ${present.has(relative) ? 'it declares no condition, so it needs no exception' : 'the config is gone'}`);
    }
  }
  return problems;
}
