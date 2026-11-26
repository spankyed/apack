// A feature's frontend is its own, which is the one pack rule whose subject is the shape of a pack rather than
// what a file imports from outside it. Its own module beside `pack-rules.ts`, as `source-resolution`'s is, so the
// rule table stays a table.
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { packTargetOf } from '@apackdev/host/build/own-module-specifiers';
import { readSubpathImports } from '@apackdev/host/build/subpath-imports';
import { readSource, type SourceView } from './pack-sources.ts';
import type { PackFinding, PackPlace, PackWideFinding } from './pack-rules.ts';

/**
 * The source files a package publishes, from its `package.json` `exports`.
 *
 * A package's entry is where it assembles what it offers, so naming its own features' frontends there is that
 * module's job rather than a crossing: `@apackdev/host`'s `./fe` barrel is exactly that, and a pack's generated
 * `pack-entry-fe.ts` is the same module written by codegen (excluded below with the rest of `__generated__`).
 *
 * **Being published is not enough; the caller must also be outside every feature.** A package may publish a
 * feature's own module — `@apackdev/host` publishes `./settings` from `features/settings/be/index.ts` — and that is
 * a feature's barrel, not the package's assembly. What says a module is assembling the pack is where it sits,
 * not whether anyone can see it; excepting it by visibility alone hands that one feature a licence no other has.
 *
 * Derived, and it fails closed: a tree with no `package.json`, no `exports`, or an entry behind conditions excepts
 * nothing and gets the strict rule. That is the opposite of deriving an exception from a *missing* file, which
 * would widen the gate exactly when something had gone missing.
 */
function readPublishedEntryPoints(packageDir: string): Set<string> {
  const manifest = path.join(packageDir, 'package.json');
  if (!fs.existsSync(manifest)) return new Set();
  const { exports: entries } = JSON.parse(fs.readFileSync(manifest, 'utf-8')) as { exports?: Record<string, unknown> };
  return new Set(Object.values(entries ?? {})
    .filter((target): target is string => typeof target === 'string')
    .map((target) => path.resolve(packageDir, target)));
}

/**
 * Read once per pack rather than once per file: a pack's every file asks the same question, and a pack of 500
 * files would otherwise parse the same `package.json` 500 times.
 *
 * Keyed by the manifest's modification time and size as well as its path, so there is no cache to remember to
 * clear: a test tree that rewrites a pack's `exports` under a path it has used before gets the new answer, where a
 * path-keyed cache would hand back the old one and no reset call is easy to notice missing.
 *
 * The size is there because the time alone is only as fine as the filesystem: APFS records sub-millisecond
 * timestamps, but a 1-second granularity is still ordinary (ext4 without nanosecond timestamps, some container
 * volumes), and there a rewrite inside one tick reads as unchanged — which is the stale read this key exists to
 * prevent, returning on the one platform nobody checks it on.
 */
const published = new Map<string, Set<string>>();
function publishedEntryPoints(packageDir: string): Set<string> {
  const manifest = path.join(packageDir, 'package.json');
  const stat = fs.existsSync(manifest) ? fs.statSync(manifest) : undefined;
  const stamp = stat ? `${packageDir}@${stat.mtimeMs}+${stat.size}` : packageDir;
  const known = published.get(stamp) ?? readPublishedEntryPoints(packageDir);
  published.set(stamp, known);
  return known;
}

/** The local names a module binds from an import, or exports without re-exporting (`export { a }`, `export default a`) */
function localNames(node: ts.Node): string[] {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return [];
    const bindings = clause.namedBindings;
    const named = !bindings ? [] : ts.isNamespaceImport(bindings) ? [bindings.name.text] : bindings.elements.map((el) => el.name.text);
    return clause.name ? [clause.name.text, ...named] : named;
  }
  // `export default a`, and `export { a, b as c }` — the local is the name before `as`
  if (ts.isExportAssignment(node)) return ts.isIdentifier(node.expression) ? [node.expression.text] : [];
  if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) {
    return node.exportClause.elements.map((el) => (el.propertyName ?? el.name).text);
  }
  return [];
}

/**
 * The spans of the declarations in `view` that pass another module's exports on: `export … from '…'`, and an
 * import whose bindings this module exports again.
 *
 * Spans rather than specifier text, because one file may both import a module plainly and re-export from it, and
 * only the second is a door. The regex this replaced correlated two passes by byte offset to tell them apart;
 * with a syntax tree the declaration is the unit, so the containment test below is all it takes.
 *
 * Deliberately no wider than what it replaced: `export { a }` and `export default a`, not `export const a =
 * imported` or a binding passed on inside an object literal. Widening it would report imports the old rule
 * allowed, and there are none to report today.
 */
function doorSpans(view: SourceView): { start: number; end: number }[] {
  const exported = new Set(view.visit((node) => (ts.isImportDeclaration(node) ? undefined : localNames(node))).map(({ what }) => what));
  return view.visit((node) => {
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) return [''];
    if (!ts.isImportDeclaration(node)) return undefined;
    return localNames(node).some((name) => exported.has(name)) ? [''] : undefined;
  });
}

/**
 * Each import of another feature's frontend this file makes. A feature reaches into no other feature's frontend at
 * all: what one offers the rest is its surface's contract — its published state, which `#generated/fe` generates
 * typed readers for, and the inbox `#generated/events` types the sends with. Neither needs a module of the other
 * feature's, so there is nothing left for an exception to bless.
 *
 * A feature's modules outside its `fe/` may use its frontend but not pass it on (`export … from './fe/state'`),
 * which would be a second door.
 *
 * Two modules are exempt, and both are the pack's own assembly rather than one feature reaching another: generated
 * code, which registers every feature's surface, and what the package publishes (`publishedEntryPoints`).
 *
 * Which specifiers it can follow at all is `packTargetOf` (`@apackdev/host/build/own-module-specifiers`), not
 * restated here: a pack-internal one, relative or a `#` subpath of the pack's own.
 *
 * It reads a syntax tree, as every rule here does bar none. It used to match regexes over the repo's packs, where
 * 28% of what it read were `.vue` files read whole: a commented-out import, one in a `<template>`, one in a
 * template literal and a CSS `@import` in a `<style>` block all counted, while a module path in a `vi.mock` did
 * not.
 *
 * The layout comes from `at.inRoot`, so it is the same whether the caller pointed at `src` or at `tests`, and the
 * root is walked back from the file by that depth rather than assumed. Which is why `inRoot` is measured from the
 * file's own half and not from the directory a runner happened to walk: pointed at one feature, the old reading
 * was two segments short and this walked back to the wrong root, finding nothing and saying so to nobody.
 */
export function crossFeatureFindings(view: SourceView, at: PackPlace): PackFinding[] {
  if (at.generated) return [];
  const root = path.resolve(view.file, ...at.inRoot.split('/').map(() => '..'));
  const relative = (file: string) => path.relative(root, file).split(path.sep).join('/');
  const featureOf = (file: string) => /^features\/([^/]+)\//.exec(relative(file))?.[1];
  const ownFeature = featureOf(view.file);
  // What the package publishes, from outside every feature: the module that assembles it
  if (ownFeature === undefined && publishedEntryPoints(at.packDir).has(view.file)) return [];
  const inOwnFrontend = /^features\/[^/]+\/fe\//.test(at.inRoot);
  const doors = inOwnFrontend ? [] : doorSpans(view);
  return view.specifiers.flatMap(({ text, line, start, end }) => {
    const target = packTargetOf(at.packDir, at.imports, view.file, text);
    if (target === undefined) return [];
    const into = /^features\/([^/]+)\/fe(?:\/.+)?$/.exec(relative(target));
    if (!into) return [];
    const passedOn = doors.some((door) => start >= door.start && end <= door.end);
    if (into[1] === ownFeature && (inOwnFrontend || !passedOn)) return [];
    return [{ line, what: text, start, end }];
  });
}


/** The file a path without an extension names: itself, `<path>.ts`, or `<path>/index.ts` */
function sourceFile(base: string): string | undefined {
  return [base, `${base}.ts`, path.join(base, 'index.ts')]
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

/**
 * The generated modules a contract leaf's closure may not reach. Both reasons are the rule's own, stated below;
 * this is what they come to when read against a pack's generated tree.
 *
 * - `system-specs`, `events` and `fe` are generated **from** the contracts: their own specifiers name one, so a
 *   module the leaf reaches importing one closes the loop codegen read the contract as a declared type to avoid.
 *   Measured on both packs here, those three are exactly the generated modules that import a contract.
 * - `pack-entry` and `pack-entry-fe` import the actors, which is the cost half: reaching either parses and binds
 *   every machine and its whole closure, and puts the machine's inferred type in the pack's published facade.
 *
 * **Not transitive reach**, deliberately. Twelve of default-setup's sixteen generated modules reach a contract
 * through some hop — `repository` does, through a feature's repository index — and a module the leaf reaches is
 * meant to use the repository facade, which the case beside this rule's asserts. What sets these five apart is that
 * codegen derives them from the thing it is reading, or from the thing it is reading around.
 */
export const GENERATED_BEHIND_A_CONTRACT = ['system-specs', 'events', 'fe', 'pack-entry', 'pack-entry-fe', 'state', 'state-fe'];

/**
 * `file:line: specifier` for each import a contract leaf makes that would put the machine back in front of codegen.
 *
 * A leaf is a module `apack.json` names at `features[].surface.contract` or `features[].system.contract`, and
 * codegen reads the contract from it as a declared type — without resolving the actor it describes. Both actors
 * import `#generated/events`, and `#generated/events` imports both contracts, so reading a contract anywhere its
 * actor is reachable closes that loop again. The two sides are one rule with one machine module each: `fe/state`
 * for a surface, `be/system` for a system.
 *
 * So a leaf imports neither machine, no other feature, and nothing generated but `types` and `ears`, which are
 * themselves leaves: a context needs both (`NoteDTO`, `EARS.EntityId`) and neither reaches `#generated/events`.
 * Those two are for the types a contract's state and its events' payload *fields* name, and no further: what
 * codegen reads out of a contract — an event's `type` literal and the union it sits in — may never come from
 * generated code, which codegen writes after reading every contract, so a pack that names one there never builds
 * (`apack-sdk`'s `module-exports.ts` says so in the failure).
 *
 * The cycle is one of two reasons, and the other is cost, recorded at `generate-entries.ts:433`: the contracts are
 * in codegen's TypeScript program and the machines are not, so an import that puts one back in reach parses and
 * binds every machine and its whole closure, XState and Vue included, for nothing.
 *
 * **Two harms, and which one a contract gets depends on where the machine's type resolves from.** Measured
 * 2026-09-27 on the external-pack fixture, five mutations, each from a cold tree (`rm -rf src/__generated__`):
 *
 * - A contract's `state` or `context` from the machine, and an `incoming` as `Extract<>` over the machine's event
 *   union, **build with exit 0** and a byte-identical `src/__generated__/events.ts` — nothing reads those
 *   positions. So does a surface `inbox` naming a plain union the machine module happens to declare.
 *   What moves is the published facade: `dist/types/pack-types.d.ts` grew by 41 lines, gaining `import * as xstate
 *   from 'xstate'` and the machine's whole declaration, every action name included, where a contract of its own
 *   contributes one interface — and a dependent's facade inlines its dependencies' verbatim, so it travels a hop
 *   further. Not a *disallowed* import: `apack-cli`'s `build/facade-gate.ts` allows `xstate` and `zod`, which
 *   every dependent has. The harm is size and coupling.
 * - A read position — the surface's `inbox`, the system's `outgoing` — resolving *through the machine's own type
 *   parameters* **refuses, every time**. `EventFromLogic<typeof theMachine>` passes through
 *   `defineSystem<Contract>()` and so back through the contract, which collapses it to `any`, and codegen refuses
 *   an `any` there. It never comes right: the throw means the generated module it needed is never written, so the
 *   next run starts from the same tree.
 *
 * That is why the rule is not switchable and why an external pack needs it: one shape breaks the build for good,
 * the other ships the machine to every dependent, and nothing else tells the author either.
 *
 * Not a *disallowed* import, though, and that is worth knowing before deriving it again: `apack-cli`'s
 * `build/facade-gate.ts` allows a facade to import `@apackdev/*`, Node built-ins and `@apackdev/sdk`'s peers, `xstate`
 * and `zod` among them, because every dependent has them. The leak is size and coupling, not resolution.
 *
 * **Codegen's own refusal is not a second guard for this.** `checkResolved`
 * (`apack-sdk/src/build/module-exports.ts`) refuses a type that collapsed to `any` in the four positions a reader
 * reads — the contract, `outgoing`, `inbox`, and each member of an event union — and reads a collapse in `state`,
 * `context` or an event's payload as data. It has to: `src/__generated__/` is untracked and codegen computes every
 * generated file before its caller writes any of them, so on a pack's first build nothing under `#generated/`
 * resolves and those positions are legitimately `any` (`actions/fe/contract.ts` has two). So of the claims below,
 * only the closure's reach to `#generated/events` overlaps that refusal, and only where the collapse lands in one
 * of the four; the rest have no other guard in any tree.
 */
/**
 * A pack's contracts where no manifest names them: `features/<id>/{be,fe}/contract.ts`, which is the layout
 * every pack in this repo is written to.
 *
 * Two trees have no `apack.json` and never will. The app is the pack `host` and its features are real code;
 * the CLI's scaffold builds its manifest in code, from an object with computed keys. Both sit in this rule's
 * population deliberately, and while the manifest was the only way in, the rule answered `[]` before reading
 * either of them — so the host's two contracts had never been checked at all.
 *
 * Only a fallback: a manifest that names contracts is still the authority, because it can name one this
 * layout would miss.
 */
function byLayout(src: string): string[] {
  const features = path.join(src, 'features');
  if (!fs.existsSync(features)) return [];
  return fs.readdirSync(features, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => ['be', 'fe'].map((half) => path.join(features, entry.name, half, 'contract.ts')))
    .filter((file) => fs.existsSync(file));
}

export function contractLeafFindings(packDir: string): PackWideFinding[] {
  const src = path.join(packDir, 'src');
  const manifestPath = path.join(packDir, 'apack.json');
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      features?: Record<string, { surface?: { contract?: string; state?: string }; system?: { contract?: string; entry?: string } }>;
    }
    : undefined;
  /** A `"path"` or `"path#Export"` the manifest names, as a file in the pack */
  const named = (target: string | undefined): string | undefined =>
    target ? sourceFile(path.join(packDir, target.split('#')[0]!)) : undefined;
  type Feature = NonNullable<NonNullable<typeof manifest>['features']>[string];
  const files = (pick: (f: Feature) => Array<string | undefined>) =>
    Object.values(manifest?.features ?? {}).flatMap((feature) => pick(feature).flatMap((t) => { const f = named(t); return f ? [f] : []; }));

  const leaves = manifest ? files((f) => [f.surface?.contract, f.system?.contract]) : byLayout(src);
  /**
   * The actor modules `apack.json` names. Exact, where the machine rule below is a guess at a filename: these
   * are the two paths the manifest states outright, so a leaf reaching one is reported whatever it is called.
   */
  const actorEntries = new Set(manifest ? files((f) => [f.surface?.state, f.system?.entry]) : []);
  // The pack's own `#` subpaths, which is how a pack names its own modules and so how its features reach each
  // other. Two of `default-setup`'s contract closures used to end at one of those imports — including
  // `threads/be/types.ts` reaching `code/`, a cross-feature hop the walk stopped at.
  // A `#generated/…` specifier never reaches the resolver, being matched and classified below *before*
  // resolution, where `types`/`ears` are told apart from `events`/`fe` — a distinction the file a specifier
  // resolves to cannot make.
  const imports = readSubpathImports(packDir);
  const resolveFrom = (from: string, specifier: string): string | undefined => {
    const base = packTargetOf(packDir, imports, from, specifier);
    return base === undefined ? undefined : sourceFile(base);
  };
  const relative = (target: string) => path.relative(src, target).split(path.sep).join('/');
  return leaves.flatMap((leaf) => {
    const ownFeature = /^features\/([^/]+)\//.exec(relative(leaf))?.[1];
    const seen = new Set<string>();
    const found: PackWideFinding[] = [];
    // The whole closure, not just the leaf's own imports: a module the leaf reaches through two hops puts
    // `#generated/events` back in the contract's path just as surely as importing it directly would.
    const walk = (file: string, viaLeaf: boolean) => {
      if (seen.has(file)) return;
      seen.add(file);
      // The reader's specifiers, not a text match: a commented-out import and one inside a template literal are
      // both `from '…'` to a regex, and this rule used to report either as a leaf reaching the machine
      for (const { text: specifier, line } of readSource(file).specifiers) {
        // The specifier is the finding; where it sits and, deeper in the closure, which leaf reaches it are
        // places, which each consumer writes its own way (`formatPackWide`)
        const at: PackWideFinding = {
          what: specifier,
          at: { file: path.relative(packDir, file), line },
          ...(viaLeaf ? {} : { from: path.relative(packDir, leaf) }),
        };
        const generated = /^#generated\/(.+?)(?:\.(?:ts|js))?$/.exec(specifier);
        if (generated) {
          // Two rules, and they are not the same one. The leaf's own imports are held to `types` and `ears`
          // because those are what a context legitimately needs — a policy, not a fact about the generated tree:
          // six generated modules reach neither a contract nor an actor, and the other four are simply not
          // something a contract has business naming. Deeper in the closure the population is
          // `GENERATED_BEHIND_A_CONTRACT` above, so a module the leaf reaches may use the rest.
          const offends = viaLeaf
            ? !['types', 'ears'].includes(generated[1])
            : GENERATED_BEHIND_A_CONTRACT.includes(generated[1]);
          if (offends) found.push(at);
          continue;
        }
        const target = resolveFrom(file, specifier);
        if (target === undefined) continue;
        const into = /^features\/([^/]+)\//.exec(relative(target));
        if (viaLeaf && into && into[1] !== ownFeature) { found.push(at); continue; }
        // The surface and the system definitions, which the manifest names: reaching either puts the actor in
        // front of the contract, at any depth — a leaf's own types module has no business importing one either.
        if (actorEntries.has(target)) { found.push(at); continue; }
        // The machines themselves, by the filenames the scaffold writes. A guess, deliberately: `Surface.state`
        // is a value, so no manifest field names the machine, and this is what makes the report say "your leaf
        // imports ./state" instead of naming a module three hops away that happens to reach #generated/events.
        // A machine called something else still fails, on the closure rule above — just less precisely.
        //
        // Not scoped to the own feature, and that is what makes narrowing the rule above the wrong repair for the
        // overlap with `cross-feature-imports`: another feature's `fe/state.ts` matches here too, so exempting
        // `fe/` there only re-attributes the identical finding to this line. Narrowing both loses the precise
        // report this guess exists to give, and letting the walk through recurses the other feature's whole
        // frontend closure. The overlap is settled where it belongs, in `packRuleProblems`' site dedupe.
        if (viaLeaf && /(?:^|\/)(?:state|system)(?:\.ts)?$/.test(relative(target))) { found.push(at); continue; }
        walk(target, false);
      }
    };
    walk(leaf, true);
    return found;
  });
}
