// Repo-wide import rules. The `checks` table at the bottom pairs each `find*` with the rule it enforces.
//
//   tsx scripts/check-import-specifiers.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { builtinModules } from 'node:module';
import ts from 'typescript';
import { SHARED_INSTANCE_PACKAGES } from '@apackdev/host/build/shared-deps';
import { packageName } from '@apackdev/host/build/specifiers';
import { SOURCE_CONDITION } from '@apackdev/host/build/source-resolution';
import { ownModuleFindings } from '@apackdev/host/build/own-module-specifiers';
import { packRuleProblems, type PackRuleKey } from '../packages/apack-cli/src/build/pack-rules.ts';
import { moduleOf, readSource, sourceFiles } from '../packages/apack-cli/src/build/pack-sources.ts';
import type { Fix } from './lib/specifier-fixes.ts';
import {
  CHECKED_DIRS, checkedDirs, filesUnder, PACK_CODE_DIRS, packCodeDirs, packDirs, packageSourceDirs,
  packRootOf, PACK_SOURCE_DIRS, PACK_SRC_ROOTS, PACK_TEST_DIRS, readJsonFile, repoRelative, repoRoot,
  SOURCE_EXTENSIONS,
} from './lib/import-populations.ts';
import { DIR_BY_PACKAGE, RUNTIME_ONLY_DEPS } from './lib/workspace-deps.ts';
import {
  DECLARES_SOURCE_BY_DESIGN, findMissingSourceConditions, RESOLVES_DIST_BY_DESIGN, sourceConditionPackages,
} from './lib/import-source-conditions.ts';
import { backed, type ImportRule, type PackParity, packRule } from './lib/import-rules.ts';
import { loadedByThePools, syncSpawnImportsIn } from './lib/process-spawns.ts';
import { listLines, ruleRows as rowsOf, type RuleRow, ruleTable } from './lib/import-list.ts';

// Re-exported so the consumers of this file keep importing from it: it is the command, and the command is the
// name everything else knows. `scripts/lib/import-populations.ts` and `./lib/import-source-conditions.ts` are
// where they are defined.
export { checkedDirs, packCodeDirs, packDirs, packageSourceDirs };
export { type ImportRule, type PackParity, packRule };
export { DECLARES_SOURCE_BY_DESIGN, findMissingSourceConditions, RESOLVES_DIST_BY_DESIGN, sourceConditionPackages };

/** `file:line: specifier` for each specifier in `files` that `matches` */
function findSpecifiers(files: string[], root: string, matches: (text: string) => boolean): string[] {
  const problems: string[] = [];
  for (const file of files) {
    for (const { text, line } of readSource(file).specifiers) {
      if (matches(text)) problems.push(`${path.relative(root, file)}:${line}: ${text}`);
    }
  }
  return problems;
}

/**
 * `file:line: specifier` for each relative emitted-extension specifier that names a TypeScript module.
 * An import of hand-written declarations (`./speech-event.js` → speech-event.d.ts) has no source and is fine.
 *
 * The `@apackdev` packages only. A pack's sources are covered by `own-modules` instead — the pack rule that
 * resolves a specifier against the pack's files and so reports the file to write rather than only the offence,
 * and the one `apack pack build` already runs for every pack. Two rules claiming one relative `.js` is what let the
 * double-claim hide before (`docs/goals/goal-one-rule-set.md`): whichever ran first was the only one reported.
 */
export function findJsSpecifiers(dirs: readonly string[] = CHECKED_DIRS, root = repoRoot): string[] {
  return jsSpecifierFixes(dirs, root).map(({ file, line, specifier }) => `${file}:${line}: ${specifier}`);
}

/**
 * The same findings before they become sentences, with the source each `.js` should have named.
 *
 * `npm run specifiers:fix` splices `named` over the span; the message and the repair come from one place, so
 * "fixable" is not a second judgement but whether this returned the finding.
 */
export function jsSpecifierFixes(dirs: readonly string[] = CHECKED_DIRS, root = repoRoot): Fix[] {
  const fixes: Fix[] = [];
  for (const dir of dirs) {
    // A listed directory that is gone means the list is stale and something is no longer checked,
    // which is worth failing over — but say so, rather than letting a readdir ENOENT stack out
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) throw new Error(`${dir} is listed among the checked directories and does not exist: remove it, or restore the directory`);
    for (const file of filesUnder([dir], root)) {
      for (const { text, line, start, end } of readSource(file).specifiers) {
        if (!/^\.{1,2}\//.test(text)) continue;
        const emitted = path.extname(text);
        const base = path.resolve(path.dirname(file), text.slice(0, -emitted.length));
        const source = (SOURCE_EXTENSIONS[emitted] ?? []).find((ext) => fs.existsSync(`${base}${ext}`));
        if (source === undefined) continue;
        fixes.push({
          file: repoRelative(root, file),
          line, start, end,
          specifier: text,
          named: `${text.slice(0, -emitted.length)}${source}`,
        });
      }
    }
  }
  return fixes;
}

/** The repo root, for a command that acts on what these rules report */
export const repoRootDir = (): string => repoRoot;

/**
 * Every own-module specifier in this repo's packs that names no file, with the file it should name.
 *
 * The rule is `@apackdev/cli`'s `own-modules`; this is its findings before they become sentences, which is what
 * `specifiers:fix` splices. A pack's own `apack pack build` gets the same repair through the same function.
 */
export function packOwnModuleFixes(dirs: readonly string[] = PACK_CODE_DIRS, root = repoRoot): Fix[] {
  return dirs.flatMap((dir) => {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) return [];
    const packDir = packRootOf(full, root);
    const found = filesUnder([dir], root).flatMap((file) => readSource(file).specifiers.map(({ text, line, start, end }) => ({
      file: repoRelative(packDir, file),
      line, specifier: text, start, end,
    })));
    return ownModuleFindings(packDir, found).flatMap(({ file, line, specifier, named, start, end }) =>
      start === undefined || end === undefined ? [] : [{
        file: repoRelative(root, path.join(packDir, file)),
        line, start, end, specifier, named,
      }]);
  });
}

/** Any module specifier, including ones inside comments and strings */
const ANY_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

/** `file:line: specifier` for each specifier in `files` that `matches`, read as text so template strings count too */
function findSpecifierText(files: string[], root: string, matches: (specifier: string) => boolean): string[] {
  return files.flatMap((file) => {
    const code = fs.readFileSync(file, 'utf-8');
    return [...code.matchAll(ANY_SPECIFIER)].filter((match) => matches(match[1]))
      .map((match) => `${path.relative(root, file)}:${code.slice(0, match.index).split('\n').length}: ${match[1]}`);
  });
}

type Rule = (node: ts.Node) => string[] | undefined;

/**
 * `file:line: what` for each finding of `rule` in `files`. A syntax tree leaves out comments and string
 * text; a .vue file is read in its <script> blocks, and in the CLI's template sources the template
 * literals are pack code, so they are scanned as such.
 */
function findInFiles(files: string[], root: string, rule: Rule): string[] {
  return files.flatMap((file) => {
    const relative = repoRelative(root, file);
    return readSource(file).visit(rule).map(({ line, what }) => `${relative}:${line}: ${what}`);
  });
}

/** `file:line: name from module` for each untyped send or repository registration a pack source names. Generated files are exempt. */
export function findRawPackHelpers(dirs: readonly string[] = PACK_SOURCE_DIRS, root = repoRoot): string[] {
  return packRule('untyped-sends', dirs, root);
}

/** `file:line: sendToSurface(…)` for each cross-surface send a feature's component makes. Extensions are exempt. */
export function findComponentSends(dirs: readonly string[] = PACK_SOURCE_DIRS, root = repoRoot): string[] {
  return packRule('component-sends', dirs, root);
}

/** `file:line: name from module` for each host-only export a pack's sources or tests import. Generated files are exempt. */
export function findInternalPackageImports(dirs: readonly string[] = PACK_CODE_DIRS, root = repoRoot): string[] {
  return packRule('internal-package-imports', dirs, root);
}

/**
 * `file:line: specifier` for each `@apackdev/host` module a pack source loads. The host package is
 * private to the app; packs use @apackdev/sdk (`services.appData`, `services.runHistory`, …).
 */
export function findHostImports(dirs: readonly string[] = PACK_CODE_DIRS, root = repoRoot): string[] {
  return packRule('host-imports', dirs, root);
}

/** `file:line: what` for each raw event path a pack source uses, which the typed sends in #generated/events replace */
export function findRawTransport(dirs: readonly string[] = PACK_SOURCE_DIRS, root = repoRoot): string[] {
  return packRule('raw-transport', dirs, root);
}

/**
 * `file:line: console.<method>` for each console use in pack backend code, which logs with
 * `createLogger` from `@apackdev/sdk/logger`. Only pack `src` directories are checked: not the CLI's
 * template sources (their console output is the CLI's) or single files.
 */
export function findPackBackendConsole(dirs: readonly string[] = PACK_SOURCE_DIRS, root = repoRoot): string[] {
  return packRule('backend-console', dirs, root);
}

/**
 * `file:line: localStorage` for each raw window-storage use in a pack's source, which reaches its own
 * storage through `surfaceStorage`/`useSurfaceStorage` from `@apackdev/sdk/fe` instead. Source only: a
 * pack's test asserting what its surface stored has to read storage.
 */
export function findPackWindowStorage(dirs: readonly string[] = PACK_SOURCE_DIRS, root = repoRoot): string[] {
  return packRule('window-storage', dirs, root);
}

/**
 * `file:line: _call:` for each write of the reserved key a delivery door puts a call under.
 *
 * The key is the app's: `_callOn` writes it and `_callOf` reads it, so a property a pack writes under that
 * name is overwritten on the way in and read as a correlation on the way out. The rule is the CLI's, so an
 * external pack is refused it too.
 *
 * **Over `PACK_CODE_DIRS`, tests included, because a test is where the key is reached for.** A pack's own
 * code has the two verbs and no reason to name the key; a spec driving a machine with no delivery door in
 * front of it has to synthesise what a door would write, and `answerTo` (`@apackdev/sdk/testing`) is that.
 * `apack pack test` runs this rule over a pack's `tests` for the same reason, so the two entry points agree.
 */
export function findReservedEventKeys(dirs: readonly string[] = PACK_CODE_DIRS, root = repoRoot): string[] {
  return packRule('reserved-event-keys', dirs, root);
}

/**
 * `file:line: specifier` for each `@/…` a pack names one of its own modules with.
 *
 * A pack names its own modules with `#` subpath imports from its own `package.json` `imports`, which Node,
 * Vite and esbuild all resolve unaided and which is private to the declaring package. `@/…` is a TypeScript
 * `compilerOptions.paths` mapping that no runtime reads — and it was not even a static one here, meaning
 * *the importer's own pack*, so four separate bundler configs each carried an implementation of it: the
 * renderer's resolveId hook, the API's esbuild surface, the pack's `vite-tsconfig-paths`, and `apack pack build`'s
 * own reader, which had two copies that had each missed the other's fix.
 *
 * All four are gone (`goal-one-way-to-name-your-own-modules.md`), so a single `@/` reintroduced here does not
 * fail loudly — it resolves for `tsc` and for nothing else, which is the shape of failure this refuses.
 */
export function findPackOwnAliases(dirs: readonly string[] = PACK_CODE_DIRS, root = repoRoot): string[] {
  return packRule('pack-own-aliases', dirs, root);
}

/**
 * `file:line: specifier -> what it should say` for each of a pack's own-module specifiers naming no file.
 *
 * The rule is `@apackdev/cli`'s `own-modules`, which `apack pack build`, `apack pack validate` and `apack pack test` run for
 * every pack outside this checkout. This applies it to the packs in it.
 */
export function findExtensionlessOwnModules(
  dirs: readonly string[] = PACK_CODE_DIRS,
  root = repoRoot,
): string[] {
  return packRule('own-modules', dirs, root);
}

/**
 * The app's sources by relative path, which is the one shape only a pack *inside this repo* can name.
 *
 * Not `@apackdev/host` or `@/` aliases: `host-imports` owns the package wherever a pack names it, and
 * `pack-own-aliases` owns every `@/` specifier — each over a pack's tests as well as its sources. Several
 * rules claiming one import means only the first to run gets read.
 */
const APP_SPECIFIER = /^(?:\.\.?\/)+(?:[\w.-]+\/)*(?:api|apack-host|apack-cli)\/src(?:\/|$)/;

/**
 * `file:line: specifier` for each app module a pack's unit tests load. Tests of app code belong to
 * that package; pack tests use @apackdev/sdk and @apackdev/testing.
 */
export function findAppImportsInPackTests(dirs: readonly string[] = PACK_TEST_DIRS, root = repoRoot): string[] {
  return findSpecifierText(filesUnder(dirs, root), root, (text) => APP_SPECIFIER.test(text));
}

/**
 * The layered packages, lowest first (docs/goals/goal-package-boundaries.md, Decision 1): the `@apackdev/*`
 * packages each may import, and path patterns it must never load.
 */
export const LAYERS: {
  name: string;
  dir: string;
  allowed: string[];
  forbidden?: RegExp;
}[] = [
  { name: '@apackdev/ears', dir: 'packages/apack-ears', allowed: [] },
  { name: '@apackdev/sdk', dir: 'packages/apack-sdk', allowed: ['@apackdev/ears'] },
  {
    name: '@apackdev/host',
    dir: 'packages/apack-host',
    allowed: ['@apackdev/sdk', '@apackdev/ears'],
    // The API: its package, its `@/` alias, or its sources by relative path
    forbidden: /^(?:@app\/api(?:\/|$)|@\/|(?:\.\.?\/)+(?:[\w.-]+\/)*api\/(?:src|scripts)(?:\/|$))/,
  },
  { name: '@app/api', dir: 'packages/api', allowed: ['@apackdev/ears', '@apackdev/sdk', '@apackdev/host'] },
  { name: '@app/renderer', dir: 'packages/renderer', allowed: ['@apackdev/sdk', '@apackdev/host', '@apackdev/ui'] },
  // Published alongside the SDK rather than above it: a component takes its contracts and host-shared state
  // from `@apackdev/sdk/fe`, and the other direction is already refused by the SDK's own row
  { name: '@apackdev/ui', dir: 'packages/apack-ui', allowed: ['@apackdev/sdk'] },
  // The harness binds a test runtime, so it reaches the host; it may not reach the component library or the
  // CLI, which are above it
  { name: '@apackdev/testing', dir: 'packages/apack-testing', allowed: ['@apackdev/ears', '@apackdev/sdk', '@apackdev/host'] },
  // Tooling at the top, so `allowed` forbids nothing — what this row is for is the other half, the manifest:
  // it imported `@apackdev/ears` and `@apackdev/testing` and declared neither until this row existed.
  //
  // `@apackdev/ui` is here as the pack FE bundler's *subject* rather than as a dependency of this code: `src`
  // only ever resolves it by name — the Tailwind content globs, the host-proxy decision (`build.bundleUi`),
  // `CHECKOUT_PACKAGES` — and the one real import is a test checking that proxying against the real module.
  { name: '@apackdev/cli', dir: 'packages/apack-cli',
    allowed: ['@apackdev/ears', '@apackdev/sdk', '@apackdev/host', '@apackdev/ui', '@apackdev/testing'] },
  // `@apackdev/cli` is allowed because the manifest declares it, and unused because that declaration is a
  // process dependency — `RUNTIME_ONLY_DEPS` is where it says so, and this row reads that rather than
  // keeping a second copy of the reason
  { name: '@app/main', dir: 'packages/main', allowed: ['@apackdev/sdk', '@apackdev/host', '@apackdev/cli'] },
  // The narrowest row, and the one worth having: a sandboxed IPC bridge has no business in the app runtime,
  // so `@apackdev/host` here would be a finding
  { name: '@app/preload', dir: 'packages/preload', allowed: ['@apackdev/sdk'] },
  // Both check the repo rather than run in it, and reach the host for the build and freshness primitives
  { name: '@app/repo-checks', dir: 'packages/repo-checks', allowed: ['@apackdev/sdk', '@apackdev/host', '@apackdev/testing'] },
  { name: '@app/publish-checks', dir: 'packages/publish-checks', allowed: ['@apackdev/sdk', '@apackdev/host'] },
];

/**
 * The workspaces this rule does not layer, and why — one entry, derived from the same fact that makes it a
 * pack.
 *
 * A pack's imports are governed by the pack rules instead (`findInternalPackageImports`, `findHostImports`),
 * which is a stricter answer than a layer row: a pack may reach only the three published packages, and that
 * `@app/default-setup` imports no `@apackdev/host` is those rules working rather than a coincidence.
 */
export const UNLAYERED_BY_DESIGN = new Map<string, string>([
  ['packages/default-setup', 'a pack: the pack rules govern what it may import, more narrowly than a layer'],
]);

const apackPackage = (specifier: string) => specifier.match(/^@apackdev\/[^/]+/)?.[0];

/**
 * Every workspace with something for the layer rule to read, by the same three directories it reads.
 *
 * Takes `root`, so a fixture tree with no `packages/` answers nothing rather than throwing — which is what
 * lets this rule's cases keep passing a synthetic layer table.
 */
const workspacesWithCode = (root: string): string[] => {
  const dir = path.join(root, 'packages');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'package.json')))
    .map((entry) => `packages/${entry.name}`)
    .filter((pkg) => filesUnder(['src', 'tests', 'scripts'].map((sub) => path.join(pkg, sub)), root).length > 0);
};

/**
 * Where a manifest names a dependency. The two rules that ask read this one list: `findPackageScriptImports`
 * restated three of the four and dropped `optionalDependencies`, so a package script importing one would have
 * been reported as undeclared — latent only because no package declares any today.
 */
export const MANIFEST_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'];

/**
 * For each layered package, over its sources, tests and scripts: `file:line: specifier` for an import
 * it makes upward, `package.json: <field>: name` for an `@apackdev/*` dependency beyond the allowed
 * ones, and `package.json: undeclared: name` for an allowed one it imports without declaring.
 */
export function findUpwardImports(layers = LAYERS, root = repoRoot, unlayered = UNLAYERED_BY_DESIGN, runtimeOnly = RUNTIME_ONLY_DEPS): string[] {
  const problems: string[] = [];
  // **Which packages this rule looks at, asked of the tree rather than of the table.** `LAYERS` is a
  // hand-written list, and it covered five of the twelve workspaces that hold code — nothing said which
  // seven were missing, so a package arrived unlayered by being forgotten rather than by a decision. The
  // population is the same expression the rule scans with, below, so coverage cannot drift from it.
  const layered = new Set(layers.map((layer) => layer.dir));
  const withCode = new Set(workspacesWithCode(root));
  for (const dir of withCode) {
    if (!unlayered.has(dir) && !layered.has(dir)) {
      problems.push(`${dir}: holds code and has no layer, so nothing says which @apackdev packages it may import`);
    }
  }
  for (const [dir, reason] of unlayered) {
    if (layered.has(dir)) problems.push(`${dir}: has a layer and is also excused as "${reason}" — drop one`);
    // And the clause the sibling lists have and this one did not: an exception outliving its reason. Only
    // where there is a population to check it against — a root with no workspaces is no evidence that an
    // entry excuses nothing, and reporting every entry there is the mirror of reporting none
    else if (withCode.size > 0 && !withCode.has(dir)) {
      problems.push(`${dir}: listed in UNLAYERED_BY_DESIGN (${reason}) but it holds no code, or is gone`);
    }
  }
  for (const { name, dir, allowed, forbidden } of layers) {
    const permitted = new Set([name, ...allowed]);
    const imported = new Set<string>();
    const files = filesUnder(['src', 'tests', 'scripts'].map((sub) => path.join(dir, sub)), root);
    problems.push(...findSpecifiers(files, root, (text) => {
      const pkg = apackPackage(text);
      if (pkg !== undefined && pkg !== name) imported.add(pkg);
      return (pkg !== undefined && !permitted.has(pkg)) || (forbidden?.test(text) ?? false);
    }));
    const manifestFile = path.join(root, dir, 'package.json');
    const manifest = readJsonFile<Record<string, Record<string, string> | undefined>>(manifestFile);
    const declared = new Set(MANIFEST_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})));
    for (const field of MANIFEST_FIELDS) {
      for (const dep of Object.keys(manifest[field] ?? {})) {
        if (dep.startsWith('@apackdev/') && !permitted.has(dep)) problems.push(`${path.relative(root, manifestFile)}: ${field}: ${dep}`);
      }
    }
    for (const pkg of [...imported].sort()) {
      if (permitted.has(pkg) && !declared.has(pkg)) problems.push(`${path.relative(root, manifestFile)}: undeclared: ${pkg}`);
    }
    // The direction that asks whether `allowed` is too wide. `imported` is already built above, so this walks
    // nothing of its own — and the reason for a permission nothing uses is the reason its *dependency* is
    // unused, which `RUNTIME_ONLY_DEPS` holds for `workspaceDeps` as well. One record, read twice
    for (const pkg of allowed) {
      const because = runtimeOnly.get(`${dir} ${pkg}`);
      if (!imported.has(pkg)) {
        if (because === undefined) problems.push(`${dir}: allows ${pkg} and imports it nowhere, so the permission grants nothing`);
      } else if (because !== undefined) {
        problems.push(`${dir}: imports ${pkg}, so its unusedBecause ("${because}") no longer applies`);
      }
    }
  }
  return problems;
}

/**
 * Every workspace dependency a manifest declares is one that package's code imports, or is named in
 * `RUNTIME_ONLY_DEPS` with what it is for instead.
 *
 * **`workspaceDeps` is a proxy, and this is its self-check.** It reads manifests to answer "what does this
 * package compile", which is a guess about someone else's code, and this repo's rule for a proxy is that it
 * needs one (root `CLAUDE.md`, "Three kinds of recorded file"). The other direction has been checked
 * for a while — an import
 * with no declaration is `findUpwardImports`' `undeclared:` clause, and it is what caught `@apackdev/ui`'s peer
 * dependency. This is the direction nothing asked: a declaration no import needs, which silently widens every
 * cache key derived from it.
 *
 * Over the whole package, not just `src`/`tests`/`scripts`: `@app/electron-versions` is imported by
 * `vite.config.js` at the package root, and a population that stopped at those three directories reported it
 * as unimported — measured, twice. `publish/` is excluded because it is a staged copy of `src`, where a
 * second reading of the same import would hide a real finding.
 */
export function findUnimportedDependencies(root = repoRoot, runtimeOnly = RUNTIME_ONLY_DEPS): string[] {
  const problems: string[] = [];
  const applied = new Set<string>();
  for (const dir of workspacesWithCode(root)) {
    const manifest = readJsonFile<Record<string, Record<string, string> | undefined>>(path.join(root, dir, 'package.json'));
    const declared = MANIFEST_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})).filter((name) => DIR_BY_PACKAGE.has(name));
    if (declared.length === 0) continue;
    const imported = new Set<string>();
    const files = filesUnder([dir], root).filter((file) => !file.includes(`${path.sep}publish${path.sep}`));
    for (const file of files) {
      for (const { text } of readSource(file).specifiers) {
        const named = declared.find((name) => text === name || text.startsWith(`${name}/`));
        if (named !== undefined) imported.add(named);
      }
    }
    for (const name of declared) {
      const key = `${dir} ${name}`;
      const reason = runtimeOnly.get(key);
      if (reason !== undefined) applied.add(key);
      if (imported.has(name)) {
        if (reason !== undefined) problems.push(`${dir}: imports ${name}, so its RUNTIME_ONLY_DEPS entry (${reason}) no longer applies`);
      } else if (reason === undefined) {
        problems.push(`${dir}/package.json: declares ${name} and imports it nowhere — delete it, or say in RUNTIME_ONLY_DEPS what it is for`);
      }
    }
  }
  for (const [key, reason] of runtimeOnly) {
    if (!applied.has(key)) problems.push(`${key}: listed in RUNTIME_ONLY_DEPS (${reason}) but no manifest declares it`);
  }
  return problems;
}

/**
 * Who may load the database (docs/goals/goal-package-boundaries.md, Decision 3): only `@apackdev/ears/lmdb` imports
 * `elmdb`. `dirs` may not import what `forbidden` matches; `except` is a directory inside them that may.
 */
export const ELMDB_RULES: { dirs: string[]; except?: string; forbidden?: RegExp; rule?: PackRuleKey }[] = [
  // The host and the API open the database through @apackdev/ears/lmdb
  {
    dirs: ['packages/apack-host/src', 'packages/apack-host/tests', 'packages/apack-host/scripts', 'packages/api/src', 'packages/api/tests', 'packages/api/scripts'],
    forbidden: /^elmdb(?:\/|$)/,
  },
  // The engine's root never loads the database: its port to one is structural (`database.ts`)
  { dirs: ['packages/apack-ears/src'], except: 'packages/apack-ears/src/lmdb', forbidden: /^(?:elmdb(?:\/|$)|(?:\.\.?\/)+(?:[\w.-]+\/)*lmdb(?:\/|$))/ },
  // Packs and their tests don't use the app's database. Named rather than spelled: this population is a pack's, so
  // the rule is `@apackdev/cli`'s, the one `apack pack build` already runs for every pack. The two above are the host's
  // and the engine's own trees, which no pack rule can have, so they keep a pattern here.
  { dirs: PACK_CODE_DIRS, rule: 'elmdb-imports' },
];

/** `file:line: specifier` for each import of elmdb or `@apackdev/ears/lmdb` where `rules` forbid it */
export function findElmdbImports(rules = ELMDB_RULES, root = repoRoot): string[] {
  return rules.flatMap(({ dirs, except, forbidden, rule }) => {
    if (rule) return packRule(rule, dirs, root);
    const allowed = except && path.join(root, except) + path.sep;
    const files = filesUnder(dirs, root).filter((file) => !allowed || !file.startsWith(allowed));
    return findSpecifiers(files, root, (text) => forbidden!.test(text));
  });
}

/** The one module that asks git what files this repo has; every other caller goes through it */
const REPO_FILES_READER = 'packages/repo-checks/tests/_support/repo-files.ts';

/**
 * Callers that run `git ls-files` themselves on purpose, with the reason each does.
 *
 * The rule exists because the question has a wrong answer that looks right: `git ls-files` alone reports the
 * *index*, which holds a file deleted from the worktree and not yet staged and omits one written and not yet
 * staged. Four checks read what it returned and died with ENOENT on the first; every check missed the second
 * entirely. `repoFiles()` asks `-co --exclude-standard` and drops what is not on disk.
 *
 * An entry that stops applying is reported, so the list cannot outlive its reasons.
 */
const ASKS_GIT_DIRECTLY: Record<string, string> = {
  'packages/apack-testing/src/performance/identity.ts':
    '`--others --exclude-standard` asks only for untracked source; tracked changes come from git diff, '
    + 'so a combined tracked/untracked enumeration would misclassify clean tracked files as dirty',
  'packages/repo-checks/tests/chain-inputs.spec.ts':
    '`--others --ignored --directory` asks which roots are gitignored — a different question, which lists '
    + 'directories and reads none of them',
};

/**
 * `file:line: "ls-files"` for each caller that asks git for the repo's files without going through
 * `repoFiles()`, and each entry in `ASKS_GIT_DIRECTLY` that no longer applies.
 */
export function findRawGitListings(dirs: readonly string[] = CHECKED_DIRS, root = repoRoot,
  excepted = ASKS_GIT_DIRECTLY): string[] {
  const rule: Rule = (node) => (ts.isStringLiteralLike(node) && node.text === 'ls-files'
    ? [JSON.stringify(node.text)] : undefined);
  const applied = new Set<string>();
  const problems = filesUnder(dirs, root).flatMap((file) => {
    const relative = repoRelative(root, file);
    if (relative === REPO_FILES_READER) return [];
    const found = findInFiles([file], root, rule);
    if (found.length === 0) return [];
    if (excepted[relative] !== undefined) { applied.add(relative); return []; }
    return found;
  });
  for (const [relative, reason] of Object.entries(excepted)) {
    if (!applied.has(relative)) {
      problems.push(`${relative}: listed in ASKS_GIT_DIRECTLY (${reason}) but it no longer runs git ls-files`);
    }
  }
  return problems.sort();
}

/**
 * Modules the integration and native pools load that start a synchronous process on purpose, with why.
 *
 * An entry that stops applying is reported, so the list cannot outlive its reasons.
 */
const SYNC_SPAWN_ALLOWED: Record<string, string> = {
  'packages/repo-checks/tests/_support/repo-files.ts':
    '`git ls-files` takes milliseconds, and many fast specs read the repo\'s files synchronously at module and describe time',
};

/**
 * `file: execFileSync, spawnSync` for each module the integration or native pools load that imports a synchronous
 * `child_process` export, and each `SYNC_SPAWN_ALLOWED` entry that no longer does.
 *
 * A synchronous process blocks the vitest worker for as long as it runs, so the case's own timeout cannot fire and
 * vitest's fixed 60s RPC window expires, failing as an anonymous timeout rather than naming the slow command.
 */
export function findSyncSpawnsInSlowSpecs(files: readonly string[] = loadedByThePools(repoRoot), root = repoRoot,
  allowed = SYNC_SPAWN_ALLOWED): string[] {
  const applied = new Set<string>();
  const problems = files.flatMap((file) => {
    const found = syncSpawnImportsIn(file);
    if (found.length === 0) return [];
    const relative = repoRelative(root, file);
    if (allowed[relative] !== undefined) { applied.add(relative); return []; }
    return [`${relative}: ${[...new Set(found)].join(', ')}`];
  });
  for (const [relative, reason] of Object.entries(allowed)) {
    if (!applied.has(relative)) {
      problems.push(`${relative}: listed in SYNC_SPAWN_ALLOWED (${reason}) but it no longer imports a synchronous spawn`);
    }
  }
  return problems.sort();
}

/** The consumers of SHARED_INSTANCE_PACKAGES (@apackdev/host/build/shared-deps), which must not list the packages themselves */
export const SHARED_LIST_CONSUMERS = [
  'packages/apack-cli/src/build/be-bundler.ts',
  'packages/apack-cli/src/build/fe-bundler.ts',
  'packages/apack-cli/src/build/content-runtime-check.ts',
  'packages/apack-host/src/packs/runtime/bridge.ts',
  'packages/apack-host/src/packs/module-bridge.ts',
  'packages/apack-testing/src/dependency-runtime.ts',
  'scripts/bundle-package.ts',
];

/**
 * `file:line: "text"` for each string in a consumer of the shared-instance list that names one of the
 * packages (`'@apackdev/sdk'`, `'@apackdev/ears/*'`) outside an import. Specific modules
 * (`'@apackdev/sdk/runtime'`) are fine: they aren't a list of what must be loaded once.
 */
export function findSharedPackageLists(files = SHARED_LIST_CONSUMERS, root = repoRoot, packages: readonly string[] = SHARED_INSTANCE_PACKAGES): string[] {
  const listed = new Set(packages.flatMap((pkg) => [pkg, `${pkg}/`, `${pkg}/*`]));
  const rule: Rule = (node) => {
    if (!ts.isStringLiteralLike(node) || !listed.has(node.text)) return undefined;
    const parent = node.parent;
    const isSpecifier = (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node;
    return isSpecifier || moduleOf(parent) === node.text ? undefined : [JSON.stringify(node.text)];
  };
  return findInFiles(files.map((file) => path.join(root, file)).filter((file) => fs.existsSync(file)), root, rule);
}

/**
 * `file:line: code` for each `repository as unknown as …` in `dirs`: each entity's repository lives
 * with the package that declares it, and other packages call it through its exports
 * (docs/goals/goal-package-boundaries.md, Decision 7), never through a cast of the engine's registry.
 *
 * The rule is the CLI's, so an external pack is refused it too. It reads more than the packs here — every
 * package's `src`, which is where all four of its real cases are.
 */
export function findRepositoryCasts(dirs: readonly string[] = packageSourceDirs(), root = repoRoot): string[] {
  return packRule('repository-casts', dirs, root);
}

/** The export condition under which @apackdev/* workspace packages resolve their TypeScript source */
// Re-exported rather than declared: `@apackdev/host/build/source-resolution` owns it beside the packages it
// applies to, and repo-checks' integration spec imports the name from here
export { SOURCE_CONDITION };

/** What a pack author's own `apack pack build` reports, for the spec that holds the two runners to agreeing */
// Same reason as above: repo-checks may not reach into another package's tree, and this script is already
// where it reads the rules from. The property it buys is the one this file's header claims — one rule,
// two entry points — which nothing could check while only one of them was reachable
export { packRuleProblems };

/**
 * `file:line: specifier` for each import of another feature's frontend, in the packs of this checkout.
 *
 * The rule is `@apackdev/cli`'s `cross-feature-imports` (`build/pack-features.ts`), which `apack pack build`,
 * `apack pack validate` and `apack pack test` run for every pack outside this checkout. `PACK_SRC_ROOTS` adds
 * `@apackdev/host`, which is the pack `host` and has the same feature layout without being a pack the CLI builds.
 */
export function findCrossFeatureImports(srcRoots: readonly string[] = PACK_SRC_ROOTS, root = repoRoot): string[] {
  return packRule('cross-feature-imports', srcRoots, root);
}

/**
 * `file:line: specifier` for each import a contract leaf makes that would put the machine back in front of codegen,
 * in the packs of this checkout.
 *
 * The rule is `@apackdev/cli`'s `contract-leaves` (`build/pack-features.ts`), which `apack pack build`, `apack pack validate`
 * and `apack pack test` run for every pack outside this checkout — where the whole reasoning, and what the two harms
 * were measured to be, is recorded.
 */
export function findContractLeafImports(srcRoots: readonly string[] = PACK_SRC_ROOTS, root = repoRoot): string[] {
  return packRule('contract-leaves', srcRoots, root);
}

/** The population `generated-behind-contract.spec.ts` checks against what codegen emits, from the rule that owns it */
export { GENERATED_BEHIND_A_CONTRACT } from '../packages/apack-cli/src/build/pack-features.ts';

/**
 * A package's own `scripts/` imports that package's `src/` and its declared dependencies, nothing else.
 *
 * Two of the three followed this already — `apack-host/scripts/sdk-modules.ts` reads `../src/build`, and
 * `apack-sdk/scripts/generate-schema.ts` reads `../src` plus a declared dependency. The third,
 * `apack-ui/scripts/exports.ts`, reached out to `scripts/lib/published-imports.ts` for a string constant
 * and a five-line directory walk.
 *
 * That is not a style point. A module under the repo's `scripts/` belongs to no package, so `npm run spec`
 * cannot route a change to it back to every spec that covers it — it sends `scripts/` to `@app/repo-checks`
 * and nothing else. A package reaching in there is a spec that will one day not run, reported green. The
 * layer rule is the other half of it (root `CLAUDE.md`): the packages' build scripts live in the repo's
 * `scripts/` so that no package's own `scripts/` imports a package above its layer, and reaching sideways
 * into `scripts/` sidesteps that while creating the same coupling.
 *
 * `@app/repo-checks` is not exempt and needs no exemption: its specs are not a package's `scripts/`.
 */
export function findPackageScriptImports(root = repoRoot): string[] {
  const packagesDir = path.join(root, 'packages');
  return fs.readdirSync(packagesDir).flatMap((pkg) => {
    const scriptsDir = path.join(packagesDir, pkg, 'scripts');
    const manifestFile = path.join(packagesDir, pkg, 'package.json');
    if (!fs.existsSync(scriptsDir) || !fs.statSync(scriptsDir).isDirectory() || !fs.existsSync(manifestFile)) return [];
    const manifest = readJsonFile<Record<string, Record<string, string> | undefined>>(manifestFile);
    const declared = new Set(MANIFEST_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})));
    const own = path.join(packagesDir, pkg) + path.sep;

    // Per file, so a relative specifier is resolved against the file that wrote it rather than guessed at
    // from its shape. `packages/api/scripts/db/` is nested, so `../../src/x` there lands inside the package
    // while `../../../scripts/x` from one level up leaves it — the same prefix, different answers.
    return [...sourceFiles(scriptsDir)].flatMap((file) => {
      const outsideThePackage: Rule = (node) => {
        const specifier = moduleOf(node);
        if (specifier === undefined) return;
        if (specifier.startsWith('.')) {
          return path.resolve(path.dirname(file), specifier).startsWith(own) ? undefined : [specifier];
        }
        // `@/…` is this repo's alias for the importing package's own `src/` (root `CLAUDE.md`, Path
        // aliases), and `#…` is a package's own `imports` map. Both stay inside the package.
        if (specifier.startsWith('@/') || specifier.startsWith('#')) return;
        if (specifier.startsWith('node:') || builtinModules.includes(specifier)) return;
        return declared.has(packageName(specifier)) ? undefined : [specifier];
      };
      return findInFiles([file], root, outsideThePackage);
    });
  });
}

/**
 * Each workspace package, resolved the way TypeScript resolves it, must land inside this checkout.
 *
 * A worktree created under the repository (Claude Code's `.claude/worktrees/`, say) is isolated for
 * writes and porous for reads: TypeScript keeps walking up for `node_modules` when a package's own
 * types target is missing, so a workspace package whose build output this checkout lacks resolves to
 * the *parent* checkout's built output. A typecheck then passes against another checkout's files —
 * including a half-finished edit someone else is making. A package that resolves nowhere is fine:
 * that is an honest "not built", which is what a worktree outside the repository gives you.
 */
export function findCrossCheckoutResolution(root = repoRoot): string[] {
  const checkout = fs.realpathSync(root);
  const host = {
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    directoryExists: ts.sys.directoryExists,
    getCurrentDirectory: () => checkout,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  };
  // A file inside the checkout: resolution starts from its directory, whether or not the file exists
  const from = path.join(checkout, 'packages', '__resolution-probe__.ts');
  const problems: string[] = [];
  for (const dir of fs.readdirSync(path.join(checkout, 'packages'))) {
    const manifest = path.join(checkout, 'packages', dir, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const { name } = readJsonFile<{ name?: string }>(manifest);
    if (name === undefined) continue;
    // Bundler resolution: the repo's other mode (nodenext) walks up the same way, so one pass sees it
    const resolved = ts.resolveModuleName(name, from, { moduleResolution: ts.ModuleResolutionKind.Bundler }, host).resolvedModule?.resolvedFileName;
    if (resolved === undefined) continue;
    const real = fs.realpathSync(resolved);
    if (real === checkout || real.startsWith(checkout + path.sep)) continue;
    problems.push(`${name} resolves to ${real}, outside this checkout (${checkout}). `
      + 'A worktree inside the repository reads the parent checkout when its own build output is missing: '
      + 'build it here, or create worktrees outside the repository (a WorktreeCreate hook).');
  }
  return [...new Set(problems)];
}

/**
 * Every rule, and the one place their ids are written.
 *
 * `as const satisfies` rather than an annotation, so each id keeps its literal type and `ImportRuleId` below is
 * *derived* from this list: a table keyed by it fails to compile when a rule is added, renamed or removed, naming
 * the id and suggesting the one it meant, where an annotation widens every id to `string` and leaves that to a
 * runtime case to notice.
 */
const RULE_LIST = [
  {
    id: 'findJsSpecifiers',
    over: CHECKED_DIRS,
    repoOnly: { kind: 'covered', by: 'own-modules', note: "Its population is the packages that are not packs: a pack's relative `.js` belongs to `own-modules`, which resolves the specifier and so names the file to write, and the two populations are asserted disjoint" },
    find: () => findJsSpecifiers(CHECKED_DIRS),
    rule: 'Relative imports must name the TypeScript source (tsc and tsdown emit .js)',
    overPaths: (paths, root = repoRoot) => jsSpecifierFixes([...paths], root).map(({ file, line, specifier }) => `${file}:${line}: ${specifier}`),
  },
  backed('findRawPackHelpers', 'untyped-sends', findRawPackHelpers, PACK_SOURCE_DIRS),
  backed('findInternalPackageImports', 'internal-package-imports', findInternalPackageImports, PACK_CODE_DIRS),
  backed('findComponentSends', 'component-sends', findComponentSends, PACK_SOURCE_DIRS),
  backed('findRawTransport', 'raw-transport', findRawTransport, PACK_SOURCE_DIRS),
  backed('findPackBackendConsole', 'backend-console', findPackBackendConsole, PACK_SOURCE_DIRS),
  backed('findPackWindowStorage', 'window-storage', findPackWindowStorage, PACK_SOURCE_DIRS),
  backed('findHostImports', 'host-imports', findHostImports, PACK_CODE_DIRS),
  backed('findPackOwnAliases', 'pack-own-aliases', findPackOwnAliases, PACK_CODE_DIRS),
  backed('findExtensionlessOwnModules', 'own-modules', findExtensionlessOwnModules, PACK_CODE_DIRS),
  {
    id: 'findAppImportsInPackTests',
    over: PACK_TEST_DIRS,
    repoOnly: { kind: 'inapplicable', note: "Its subject is a relative import into this repo's api, host or CLI sources, which only a pack inside this monorepo can write; `@apackdev/host` and every `@/` specifier belong to `host-imports` and `pack-own-aliases`, which the CLI's pack-test command runs over a pack's tests" },
    find: () => findAppImportsInPackTests(PACK_TEST_DIRS),
    // Dirs-shaped, so a per-file run can answer for it too, which is also what lets the sweeps call it
    overPaths: (paths, root = repoRoot) => findAppImportsInPackTests(paths, root),
    rule: 'Pack unit tests run on the harness (@apackdev/testing) without the app; test host, API and CLI code in its own package',
  },
  {
    id: 'findUpwardImports',
    repoOnly: { kind: 'inapplicable', note: "The `@apackdev/*` layer rule, which is about this repo's packages and their manifests" },
    find: findUpwardImports,
    rule: "Every workspace holding code has a layer (or is a pack, which the pack rules govern), packages import only downward (@apackdev/ears imports no @apackdev package, @apackdev/sdk only @apackdev/ears, @apackdev/host only those two and never the API, the API and the renderer only the packages below them), each lists every @apackdev package it imports in its package.json, and every package a layer allows is one it imports or says why not",
  },
  {
    id: 'findUnimportedDependencies',
    repoOnly: { kind: 'inapplicable', note: "About this repo's own manifests against its own imports; a pack declares no workspace" },
    find: findUnimportedDependencies,
    rule: 'Every workspace dependency a manifest declares is one that package imports, or is named in RUNTIME_ONLY_DEPS with what it is for instead — because workspaceDeps reads those manifests to build cache keys',
  },
  {
    id: 'findElmdbImports',
    repoOnly: { kind: 'covered', by: 'elmdb-imports', note: "What is left here is the API, the host and the engine's own root" },
    find: findElmdbImports,
    rule: "Only @apackdev/ears/lmdb loads elmdb: the host and the API open the database through it, the engine's root and packs never load it",
  },
  {
    id: 'findRawGitListings',
    over: CHECKED_DIRS,
    repoOnly: { kind: 'inapplicable', note: "Its subject is this repo's own checks asking git what files the repo has, a question no pack asks and a command no pack ships" },
    find: findRawGitListings,
    rule: "Ask repoFiles() what files this repo has, not git ls-files directly: the index holds a file deleted and not staged, and omits one written and not staged",
  },
  {
    id: 'findSyncSpawnsInSlowSpecs',
    repoOnly: { kind: 'inapplicable', note: "Its subject is this repo's integration and native test pools, which no pack has" },
    find: findSyncSpawnsInSlowSpecs,
    rule: 'Start a process asynchronously in the integration and native halves — promisify(execFile) with a timeout, or runCommand (apack-cli tests/_support/run-command.ts) for a CLI or vitest process tree: a synchronous one blocks the worker, so no timeout fires and the RPC window expires',
  },
  {
    id: 'findSharedPackageLists',
    repoOnly: { kind: 'inapplicable', note: 'Its subject is the host, CLI and testing consumers of `SHARED_INSTANCE_PACKAGES`, none of which is a pack' },
    find: findSharedPackageLists,
    rule: 'Derive shared-instance packages from SHARED_INSTANCE_PACKAGES (@apackdev/host/build/shared-deps) instead of naming them',
  },
  backed('findRepositoryCasts', 'repository-casts', findRepositoryCasts, packageSourceDirs()),
  backed('findReservedEventKeys', 'reserved-event-keys', findReservedEventKeys, PACK_CODE_DIRS),
  backed('findCrossFeatureImports', 'cross-feature-imports', findCrossFeatureImports, PACK_SRC_ROOTS),
  backed('findContractLeafImports', 'contract-leaves', findContractLeafImports, PACK_SRC_ROOTS),
  {
    id: 'findPackageScriptImports',
    repoOnly: { kind: 'inapplicable', note: "A package's own `scripts/`, a shape no pack has, and the reason is how `npm run spec` routes a change" },
    find: findPackageScriptImports,
    rule: "A package's own scripts/ imports that package's src/ and its declared dependencies, nothing else: a module under the repo's scripts/ belongs to no package, so npm run spec cannot route a change to it back to a spec that covers it",
  },
  {
    id: 'findCrossCheckoutResolution',
    repoOnly: { kind: 'inapplicable', note: 'Worktrees nested in this checkout, which is a property of the checkout and not of any pack' },
    find: findCrossCheckoutResolution,
    rule: 'Workspace packages resolve inside this checkout, so a worktree nested in the repository never typechecks against the parent checkout',
  },
  {
    id: 'findMissingSourceConditions',
    repoOnly: { kind: 'covered', by: 'source-resolution', note: "What is left here is the repo's own configs, which declare the condition where a pack's must not" },
    find: findMissingSourceConditions,
    rule: "The repo's own configs declare the @apackdev/source condition when they compile or bundle code importing @apackdev/ears, @apackdev/sdk or @apackdev/ui, so they read TypeScript source instead of a stale dist; a pack's configs declare none, because a pack resolves the published dist",
  },
] as const satisfies readonly ImportRule[];

/** The id of a rule, derived from the list so nothing keys a table by a name no rule has */
export type ImportRuleId = (typeof RULE_LIST)[number]['id'];

/**
 * The ids whose pack-facing half a named pack rule covers, derived the same way.
 *
 * What it is for: `by` is checked for spelling and not for coverage — a key that exists but names the wrong rule
 * compiles, prints in `--list` and passes everything. A table of evidence keyed by this makes an entry arriving
 * without any a compile error, so the claim cannot be made without being shown.
 */
export type CoveredRuleId = Extract<(typeof RULE_LIST)[number], { repoOnly: { kind: 'covered' } }>['id'];

/**
 * Every rule's id, keeping its literal type: what a table that covers the rules is keyed by.
 *
 * Separate from `CHECKS` because the two are read for different things. A tuple of literal types is what makes the
 * ids derivable, and it is also a union whose members lack the properties they do not declare — so anything that
 * asks a rule whether it has an `overPaths` or a `packRule` reads `CHECKS`, which is the same list widened, and
 * anything keyed by id reads this.
 */
export const CHECK_IDS: readonly ImportRuleId[] = RULE_LIST.map((rule) => rule.id);

/** Every rule, as the runner and the sweeps read them */
export const CHECKS: readonly ImportRule[] = RULE_LIST;

/**
 * The `--list` presentation, with the rules bound: `scripts/lib/import-list.ts` takes them, because it is the
 * command that knows which exist. Re-exported so this file stays the one name its consumers import.
 */
export const ruleRows = (checks: readonly ImportRule[] = CHECKS): readonly RuleRow[] => rowsOf(checks);
export { ruleTable, type RuleRow };

// Run as a script, also through a symlinked path (tests import findJsSpecifiers)
if (process.argv[1] && import.meta.filename === fs.realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  const only = args.includes('--rule') ? args[args.indexOf('--rule') + 1] : undefined;
  const paths = args.filter((arg) => !arg.startsWith('--') && arg !== only);
  const rules = only ? CHECKS.filter((rule) => rule.id === only) : CHECKS;

  if (args.includes('--list')) {
    for (const line of listLines(CHECKS)) console.log(line);
    process.exit(0);
  }
  if (only && rules.length === 0) {
    console.error(`No rule "${only}". --list prints them.`);
    process.exit(1);
  }

  // Every rule, not the first that fires: exiting inside the loop is what hid one offence being claimed by two
  // rules, and in one pass over the tree it saves nothing — the files have been read by then anyway.
  const failed: { rule: ImportRule; problems: string[] }[] = [];
  const skipped: string[] = [];
  for (const rule of rules) {
    if (paths.length > 0 && !rule.overPaths) {
      skipped.push(rule.id);
      continue;
    }
    const problems = paths.length > 0 ? rule.overPaths!(paths) : rule.find();
    if (problems.length > 0) failed.push({ rule, problems });
  }

  for (const { rule, problems } of failed) console.error(`${rule.rule}:\n  ${problems.join('\n  ')}\n`);
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} rule${skipped.length === 1 ? '' : 's'} that read the whole tree, `
      + `since paths were named: ${skipped.join(', ')}`);
  }
  if (failed.length > 0) {
    console.error(`${failed.length} rule${failed.length === 1 ? '' : 's'} failed.`);
    process.exit(1);
  }
  console.log(paths.length > 0 ? `Import specifiers pass for ${paths.length} path${paths.length === 1 ? '' : 's'}` : 'Import specifiers and pack rules pass');
}
