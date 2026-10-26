// Source rules shared by pack build, validation and the repository checks.
// Only development conventions may be allowed through apack.json checks.allow.
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { ALLOWABLE_PACK_CHECKS, PackChecksSchema, _namingRefusedValue } from '@apackdev/sdk/build';
import { ownModuleFindings, type OwnModuleSpecifier } from '@apackdev/host/build/own-module-specifiers';
import { readSubpathImports } from '@apackdev/host/build/subpath-imports';
// The key itself, not a copy of it: one declaration, so a rename there renames what this refuses
import { _CALL_KEY } from '@apackdev/sdk/events';
import { moduleOf, readSource, sourceFiles, type SourceView } from './pack-sources.ts';
import { contractLeafFindings, crossFeatureFindings } from './pack-features.ts';
import { configsNamingSourceCondition, packResolvesSource } from './pack-resolution.ts';

/** Where a file sits in the pack, which is all any of these rules needs besides the file itself */
export interface PackPlace {
  /** The pack root */
  readonly packDir: string;
  /**
   * The file, relative to the pack root, `/`-separated.
   *
   * Named for what it is relative to, because that was a bug: a runner passing a repo-relative path here
   * resolved every relative specifier to `<pack>/<pack>/…`, which turned `own-modules` off for the whole form
   * without failing anything. Whatever a runner *prints* is its own business and not this.
   */
  readonly packRelative: string;
  /** Relative to the `src` or `tests` root it was found under — what the backend-path rules read */
  readonly inRoot: string;
  /** A `__generated__` path segment: codegen's output, which some rules exempt */
  readonly generated: boolean;
  /** The pack's `package.json` `imports`, read once */
  readonly imports: Record<string, string>;
}


/**
 * One finding, with the span of the code it is about.
 *
 * The span is what lets the set report one message per offence. `import { _rootEvents } from '@apackdev/host/bus'`
 * breaks three rules — the package is not installed, the name is `@internal`, and `_rootEvents` is the raw
 * transport — and a pack author who has to delete one line should be told once, by the rule whose cause is the
 * most fundamental. Without spans the only way to tell "three rules, one site" from "three rules, one line"
 * would be the line number, and two real offences do share a line.
 */
export interface PackFinding {
  readonly line: number;
  readonly what: string;
  /**
   * What the finding is *about*, when `what` words it rather than naming it. Absent means `what` is already the
   * subject, which is every rule that reports a bare specifier.
   *
   * The third part of the split: `at` is where a finding is, `what` is how it reads, this is which offence it is —
   * and it is what lets two rules wording one offence differently be recognised as one. `own-modules` says
   * "'x' names no file — write 'x.ts'" where `contract-leaves` says `x`; keyed on the wording, a pack author was
   * told twice about one import.
   */
  readonly subject?: string;
  readonly start: number;
  readonly end: number;
}

/**
 * A finding whose subject is the pack rather than one file's text.
 *
 * Structured rather than a formatted string, because the two consumers write a path differently — `apack pack validate`
 * relative to the pack, as its author reads it, and `check:specifiers` relative to the repo, so a finding in one of
 * five packs says which — and free-form strings gave them no way to tell a path from prose. The repo's runner used
 * to prefix the whole string and substitute inside `(reached from …)`, which knew one rule's wording and would have
 * mangled another's: `source-resolution` reports `@apackdev/sdk -> ../apack-sdk/src/index.ts`, whose path points
 * outside the pack and must not be rewritten at all.
 *
 * So `what` is the rule's wording, `at` the place in the pack it is about when it is about one, and `from` a second
 * place the wording refers to. `formatPackWide` composes them, once, for both consumers.
 */
export interface PackWideFinding {
  readonly what: string;
  readonly at?: { readonly file: string; readonly line?: number };
  readonly from?: string;
  /** What the finding is about, when `what` words it rather than naming it — see `PackFinding.subject` */
  readonly subject?: string;
}

/** A whole-pack finding as a line, with `where` writing a pack-relative path the way this consumer wants it */
export function formatPackWide(found: PackWideFinding, where: (file: string) => string = (file) => file): string {
  const place = found.at === undefined ? '' : `${where(found.at.file)}${found.at.line === undefined ? '' : `:${found.at.line}`}: `;
  return `${place}${found.what}${found.from === undefined ? '' : ` (reached from ${where(found.from)})`}`;
}

export interface PackRule {
  /**
   * The rule's name, which `apack.json checks.allow` and `--rule` take.
   *
   * `string` rather than `PackRuleKey`, because that union is derived from this list below and a rule cannot be
   * typed by a union it defines. So a misspelled key here does not fail at the declaration — it fails at the three
   * places that pin the set: the precedence case and the firing-case coverage in `pack-rules.spec.ts`, and the
   * check that `docs/public-facing/cli.md` documents exactly these rules.
   */
  readonly key: string;
  /** The sentence reported when it fires, the same one `check:specifiers` prints */
  readonly rule: string;
  /** Whether a pack may allow it in `apack.json checks.allow`: true only when a violation has no runtime effect */
  readonly switchable: boolean;
  /** Per file, over its parsed source. Most rules are this: an offence is something a file says */
  check?(view: SourceView, at: PackPlace): PackFinding[];
  /**
   * The pack as a whole, for a rule whose subject is not any one file's text — what its compiler resolves, what
   * its manifest wires together.
   *
   * A finding that names an `at` takes part in the one-offence-one-message dedupe below, on that site: it has a
   * place another rule can be right about, even though it has no byte span. One that names none does not, and
   * that is the case the exemption was written for — `source-resolution` reports `@apackdev/sdk -> …/src/index.ts`,
   * where the path is evidence and not a location, so there is no site to claim.
   */
  checkPack?(packDir: string): PackWideFinding[];
}

/** Ref-taking sends a pack gets as name-taking ones from `#generated/events`, whichever module exports them */
const EVENT_SENDS = ['untypedBroadcastToSurface', 'untypedSendToSystem', '_sendToLocalSurface'];

/**
 * A feature's own component, which is where `useSurface()` is available and so where a cross-surface send has an
 * alternative.
 *
 * **Extensions are outside it because they address a surface differently.** A viewer, block or step form is
 * rendered by the host wherever it belongs, in no `SurfaceScope` and by no single surface — the same viewer can
 * be shown by several — so `useSurface()` has no answer for it and is not the verb it is missing. Such a
 * component reaches a surface by its ref, which is the sanctioned route (`apack-sdk/src/fe/surface-state.ts`
 * states it), and `sendToSurface` is that route's send. What a by-ref send does lack is a return address, so
 * the surface it reaches cannot answer it — which costs nothing while every one of them is a notification.
 */
const FEATURE_COMPONENT = /^features\/[^/]+\/fe\/.*\.vue$/;

/** A pack's backend: where `createLogger` replaces `console`, by the layout every pack has */
const BACKEND_PATH = /^(features\/[^/]+\/be\/|features\/hooks\.ts$|migrations\/|extensions\/)/;
const FRONTEND_OR_TEST_PATH = /\.vue$|(^|\/)(fe|register-fe)\.ts$|^extensions\/(tiptap|artifacts\/viewers|blocks\/[^/]+)\/|(^|\/)__tests__\/|\.(spec|test)\.ts$/;

/** The names one node imports from an `@apackdev` package, by their imported rather than local name */
function importedFrom(node: ts.Node): { module: string; names: string[] } | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const module = moduleOf(node);
    if (module === undefined) return undefined;
    const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
    if (!bindings || ts.isNamespaceImport(bindings) || ts.isNamespaceExport(bindings)) return { module, names: [] };
    return { module, names: bindings.elements.map((el) => (el.propertyName ?? el.name).text) };
  }
  // `const { _x } = await import('@apackdev/…')`
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name)) {
    const call = ts.isAwaitExpression(node.initializer) ? node.initializer.expression : node.initializer;
    const module = moduleOf(call);
    if (module === undefined) return undefined;
    return { module, names: node.name.elements.map((el) => (el.propertyName ?? el.name).getText()) };
  }
  return undefined;
}

/** What a pack can reach the window's storage off, so `window.localStorage` is not a way around the rule */
const WINDOW_GLOBALS: ReadonlySet<string> = new Set(['window', 'globalThis', 'self']);

/** The engine's repository registry, `repository` or `….repository`, through parentheses */
const isRepository = (node: ts.Expression): boolean => {
  const inner = ts.isParenthesizedExpression(node) ? node.expression : node;
  return (ts.isIdentifier(inner) && inner.text === 'repository')
    || (ts.isPropertyAccessExpression(inner) && inner.name.text === 'repository');
};

/** `repository as unknown as X`: reading repositories through a type the registering package doesn't declare */
const repositoryCast = (node: ts.Node): string[] | undefined => {
  if (!ts.isAsExpression(node)) return;
  const inner = ts.isParenthesizedExpression(node.expression) ? node.expression.expression : node.expression;
  if (!ts.isAsExpression(inner) || inner.type.kind !== ts.SyntaxKind.UnknownKeyword || !isRepository(inner.expression)) return;
  return [node.getText()];
};

/**
 * A property named `_call` on anything a pack writes: the reserved key the delivery doors put a call under.
 *
 * **Any property of that name, not only one on an event literal**, because the narrower check cannot be made
 * to hold: a pack builds events through variables, spreads and helpers, so "is this object an event" is not a
 * question the syntax answers. The key is reserved repo-wide for one purpose, so writing it is wrong wherever
 * it appears, and a pack with a legitimate `_call` of its own is told to rename it — which is the trade the
 * reservation is.
 *
 * Both spellings a property name takes, since `{ _call: x }` and `{ '_call': x }` are the same key.
 */
const reservedEventKey = (node: ts.Node): string[] | undefined => {
  if (!ts.isPropertyAssignment(node) && !ts.isShorthandPropertyAssignment(node)) return;
  const name = node.name;
  const written = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
  return written === _CALL_KEY ? [`${written}:`] : undefined;
};

/**
 * Every pack rule, **in precedence order**: when several are right about one site, the first reports it and the
 * rest stand down (`packRuleProblems`). The order is the order of causes — what stops the pack loading at all,
 * then what stops a specifier resolving, then what breaks on an app update, then the conventions — so an author
 * deleting one import is told the thing that matters about it.
 *
 * **Where one fix subsumes another, the subsuming one comes first**, even against that grouping. An extensionless
 * cross-feature import is both unresolvable and a crossing, and cause order alone would hand it to `own-modules`:
 * the author adds `.ts`, re-runs, and is then told the import should not exist at all. The first fix was wasted,
 * so `cross-feature-imports` outranks `own-modules` despite sitting a group later by cause. Measured before it was
 * moved: the five rules it passed contest no site with it, and the only tests that changed were the two recording
 * this order.
 */
const RULE_LIST = [
  {
    key: 'source-resolution',
    rule: "A pack compiles against the @apackdev packages' published dist, the one layout a pack author has, so "
      + "neither its tsconfig nor its Vitest config may resolve a checkout's source: esbuild and Vite's pack "
      + 'bundler ignore the @apackdev/source condition, so a pack that declares it typechecks and tests against '
      + 'source while both its bundles are built from dist',
    // The finding is the site, not the advice: the sentence above is printed once per rule by
    // `refusePackRuleViolations` and appended to each finding by `apack pack validate`, so advice carried here too
    // arrived twice, three times over for a pack that resolves all three packages
    checkPack(packDir) {
      const { resolved, unreadable } = packResolvesSource(packDir);
      // A config the rule could not read is its own finding, not an empty pass: the pack author is told the
      // check did not run, which is the one thing silence cannot say
      // None of these is a place in the pack: the first is a sentence about a config, and the second's path is
      // where the specifier landed, which is outside the pack and is evidence rather than a location
      return [...(unreadable === undefined ? [] : [{ what: unreadable }]),
        ...resolved.map(({ specifier, resolved: file }) => ({ what: `${specifier} -> ${file}` })),
        ...configsNamingSourceCondition(packDir)];
    },
  },
  {
    key: 'contract-leaves',
    rule: 'A contract leaf is a leaf: no ./state or ./system, no other feature, and nothing generated but types '
      + "and ears — codegen reads a surface's and a system's contract without resolving its actor, and an import "
      + 'that reaches one restores the cycle',
    checkPack: contractLeafFindings,
  },
  {
    key: 'host-imports',
    rule: "A pack doesn't import the host's private @apackdev/host package, which is not installed for a pack; "
      + 'use @apackdev/sdk',
    check(view, _place) {
      return view.specifiers.filter(({ text }) => /^@apackdev\/host(\/|$)/.test(text))
        .map(({ text, line, start, end }) => ({ line, what: text, start, end }));
    },
  },
  {
    key: 'elmdb-imports',
    rule: 'A pack reaches its data through the engine the app binds: neither elmdb nor @apackdev/ears/lmdb is '
      + 'provided to a pack, so importing one fails at load',
    check(view, _place) {
      return view.specifiers.filter(({ text }) => /^elmdb(\/|$)/.test(text) || /^@apackdev\/ears\/lmdb(\/|$)/.test(text))
        .map(({ text, line, start, end }) => ({ line, what: text, start, end }));
    },
  },
  {
    key: 'cross-feature-imports',
    rule: "A feature's frontend is its own: what it offers other features is its surface's contract, read through "
      + '#generated/fe and #generated/events, never a module of its own',
    check: crossFeatureFindings,
  },
  {
    key: 'own-modules',
    rule: 'A pack names its own modules by the file that is there, extension and all: no runtime resolves an '
      + 'extensionless specifier in ESM, so one works only while a build guesses the suffix and this one does not — '
      + 'and the .js a pack would otherwise name is a file it never emits, since it ships one bundle',
    check(view, place) {
      const found: OwnModuleSpecifier[] = view.specifiers.map(({ text, line, start, end }) =>
        ({ file: place.packRelative, line, specifier: text, start, end }));
      return ownModuleFindings(place.packDir, found).map(({ line, specifier, named, start, end }) =>
        // The specifier is the subject; the sentence around it is only how this rule words it
        ({ line, what: `'${specifier}' names no file — write '${named}'`, subject: specifier, start: start as number, end: end as number }));
    },
  },
  {
    key: 'pack-own-aliases',
    rule: 'A pack names its own modules with # subpath imports from its package.json (#generated/x, '
      + '#features/x): a @/ path is a TypeScript-only mapping and no runtime reads it',
    check(view, _place) {
      return view.specifiers.filter(({ text }) => text.startsWith('@/')).map(({ text, line, start, end }) => ({ line, what: text, start, end }));
    },
  },
  {
    key: 'internal-package-imports',
    rule: "A pack imports only the @apackdev packages' public API: an export named `_x` is @internal, the app's "
      + 'alone, and an app update is free to rename it',
    check(view, place) {
      if (place.generated || !view.code.includes('@apackdev/')) return [];
      return view.visit((node) => {
        const imported = importedFrom(node);
        if (!imported?.module.startsWith('@apackdev/')) return undefined;
        return imported.names.filter((name) => name.startsWith('_')).map((name) => `${name} from ${imported.module}`);
      });
    },
  },
  {
    key: 'untyped-sends',
    rule: 'Pack code uses the typed facades: broadcastToSurface, sendToSurface and sendToSystem from '
      + '#generated/events',
    check(view, place) {
      if (place.generated) return [];
      return view.visit((node) => {
        if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return undefined;
        const imported = importedFrom(node);
        if (!imported?.module.startsWith('@apackdev/')) return undefined;
        const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
        if (!bindings || ts.isNamespaceImport(bindings) || ts.isNamespaceExport(bindings)) {
          // `import * as x from`, `export * from`, `export * as x from` (a default import has no bindings)
          const namespace = bindings !== undefined || ts.isExportDeclaration(node);
          return namespace && imported.module === '@apackdev/sdk/events'
            ? ['* from @apackdev/sdk/events (import the names)'] : undefined;
        }
        return imported.names.filter((name) => EVENT_SENDS.includes(name)).map((name) => `${name} from ${imported.module}`);
      });
    },
  },
  {
    key: 'component-sends',
    rule: "A feature's component emits to its own surface with useSurface() rather than sending to another "
      + 'surface: a component runs in no delivery, so sendToSurface from one carries no Message.sender and the '
      + 'surface it reaches cannot answer it',
    check(view, place) {
      if (!FEATURE_COMPONENT.test(place.inRoot)) return [];
      return view.visit((node) => (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === 'sendToSurface' ? ['sendToSurface(…)'] : undefined));
    },
  },
  {
    key: 'raw-transport',
    rule: 'Pack code sends with broadcastToSurface, sendToSurface and sendToSystem from #generated/events, and '
      + 'subscribes with onConnected and onIncoming from @apackdev/sdk/events',
    check(view, _place) {
      return view.visit((node) => {
        const module = moduleOf(node);
        if (module && /^@apackdev\/sdk\/rpc(\/|$)/.test(module)) return [module];
        if (ts.isIdentifier(node) && node.text === '_rootEvents') return ['_rootEvents'];
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'bus'
          && ts.isIdentifier(node.expression) && node.expression.text === 'trpc') return ['trpc.bus'];
        return undefined;
      });
    },
  },
  {
    key: 'backend-console',
    rule: 'Pack backend code logs with createLogger from @apackdev/sdk/logger',
    check(view, place) {
      if (!BACKEND_PATH.test(place.inRoot) || FRONTEND_OR_TEST_PATH.test(place.inRoot)) return [];
      return view.visit((node) => {
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'console') {
          return [`console.${node.name.text}`];
        }
        return undefined;
      });
    },
  },
  {
    key: 'window-storage',
    rule: 'A surface reaches its own window storage through surfaceStorage or useSurfaceStorage from '
      + '@apackdev/sdk/fe, whose prefix is the surface\'s ref. `localStorage` and `sessionStorage` are one flat '
      + 'namespace per window, so a hand-written key is a name two packs can pick, and one a rename cannot '
      + 'reach: the key outlives whatever vocabulary its author typed, because changing it orphans the data',
    check(view, place) {
      // Source only. A pack's test asserting what its surface stored has to read storage, and routing that
      // through the handle would make the test assert through the thing it is testing.
      if (place.packRelative.startsWith('tests/')) return [];
      return view.visit((node) => {
        if (!ts.isIdentifier(node) || (node.text !== 'localStorage' && node.text !== 'sessionStorage')) return undefined;
        const parent = node.parent;
        // The name as a **property** is two different things, and one exclusion for both is how a rule
        // keeps a hole: `io.localStorage` and `{ localStorage: fake }` name somebody's own field, while
        // `window.localStorage` and `globalThis.localStorage` are the window's store spelled the long
        // way — the first shape a pack reaches for once the bare name is refused.
        if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
          return ts.isIdentifier(parent.expression) && WINDOW_GLOBALS.has(parent.expression.text)
            ? [node.text]
            : undefined;
        }
        if (ts.isPropertyAssignment(parent) && parent.name === node) return undefined;
        return [node.text];
      });
    },
  },
  {
    key: 'repository-casts',
    rule: "Read repositories through their owner's exports — a pack through `repository` from "
      + "#generated/repository, which types its own and its dependencies' — never through a cast of the engine's "
      + 'registry',
    check(view, place) {
      // The generated facade *is* this cast (`export const repository = earsRepository as unknown as
      // Repositories`), and escapes the shape below only by its import alias. Exempt it for what it is, so that
      // renaming that local in codegen cannot fail every pack's build.
      if (place.generated) return [];
      return view.visit(repositoryCast);
    },
  },
  {
    key: 'reserved-event-keys',
    rule: "`_call` is the app's key on a delivered event: the delivery doors write the call an answer "
      + 'answers under it, so a property a pack writes under that name is overwritten on the way in and read '
      + 'as a correlation on the way out — ask answersCall or settleCall from @apackdev/sdk/events rather than '
      + 'reading the key, build an answer in a test with answerTo from @apackdev/sdk/testing, and rename any '
      + 'field of your own that collides',
    check(view, place) {
      // The generated facades never write the key, so there is nothing to exempt; a generated file that
      // started to would be as wrong as a hand-written one, and is told so
      void place;
      return view.visit(reservedEventKey);
    },
  },
] as const satisfies readonly Omit<PackRule, 'switchable'>[];

/**
 * Every rule's name, derived from the list above rather than written beside it.
 *
 * It was a union of eleven strings next to an array of eleven rules, so adding one was two edits and only the
 * second was checked. One declaration now: the list is the definition, and everything that takes a key — the
 * `allow` list a pack writes, the repo's own entry points, the specs — is typed against what the list holds.
 */
export type PackRuleKey = (typeof RULE_LIST)[number]['key'];

/**
 * Every rule, as a consumer reads one: every optional member present, and the key narrowed to the union above.
 *
 * A tuple of literal types is what makes that union derivable, and it is also a union of object types whose
 * members lack the properties they do not declare — where every consumer asks a rule whether it has a `check` or
 * a `checkPack`. Widening to `PackRule` alone would take the key back to `string` with them, so the key is put
 * back: an assignment TypeScript checks, since each entry's key is one of the literals the union is made of.
 */
const SWITCHABLE: readonly PackRuleKey[] = ALLOWABLE_PACK_CHECKS;
export const PACK_RULES: readonly (PackRule & { readonly key: PackRuleKey })[] = RULE_LIST.map(rule => ({
  ...rule, switchable: SWITCHABLE.includes(rule.key),
}));

/**
 * Every source file under `within` — each a directory or a single file, relative to the pack — with where it sits.
 *
 * **The only place a `PackPlace` is built.** There used to be a second, in the repo's own script, and two of the
 * five fields had drifted from what this interface declares: one turned a rule off, the other was one nested
 * directory away from doing the same. A rule sees the same place whoever ran it, or the claim that it is the same
 * rule wherever it runs is not checkable.
 *
 * A single file, not only a directory, because `check:specifiers <paths>` names files — and a rule that reads a
 * place must not be able to tell how the caller arrived at the file.
 */
export function packPlaces(packDir: string, within: readonly string[]): { view: SourceView; place: PackPlace }[] {
  const imports = readSubpathImports(packDir);
  const found: { view: SourceView; place: PackPlace }[] = [];
  for (const entry of within) {
    const at = path.join(packDir, entry);
    if (!fs.existsSync(at)) continue;
    for (const file of fs.statSync(at).isFile() ? [at] : sourceFiles(at)) {
      const packRelative = path.relative(packDir, file).split(path.sep).join('/');
      // The half is the file's first segment, not the directory the caller happened to name: pointed at one
      // feature or one file, the old reading gave `be/system.ts` or `''`, and the two rules that match this as a
      // path shape then quietly matched nothing. They fail open, so nothing said so.
      const [, ...belowHalf] = packRelative.split('/');
      found.push({
        view: readSource(file),
        place: {
          packDir,
          packRelative,
          inRoot: belowHalf.join('/'),
          generated: packRelative.split('/').includes('__generated__'),
          imports,
        },
      });
    }
  }
  return found;
}

/**
 * Every rule's findings over the pack, by key, with the rules the pack allows left out.
 *
 * One pass over the files: each is read and parsed once and every rule sees the same view, which is what makes
 * running nine rules cost about what running one used to.
 *
 * **One offence, one message.** Several rules can be right about one line —
 * `import { _rootEvents } from '@apackdev/host/bus'` breaks three — and a pack author deleting one import should
 * be told once, by the rule whose cause comes first: the package is not installed for a pack, so whether the
 * name is `@internal` and whether it is the raw transport are beside the point. So a finding whose span sits
 * inside one an earlier rule already claimed is dropped, and `PACK_RULES`' order *is* that precedence —
 * declared there, with each rule's reason, rather than decided here.
 *
 * Spans, not lines: two real offences do share a line (`import …; console.log(…)`), and both should be
 * reported. `pack-rules.spec.ts` holds the order to what it claims.
 */
export function packRuleProblems(packDir: string, dirs: readonly string[] = ['src']): Map<PackRuleKey, string[]> {
  // Source-only callers need no manifest; owned packs use the same checks schema as full validation.
  const manifestFile = path.join(packDir, 'apack.json');
  const checks: unknown = fs.existsSync(manifestFile) ? (JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as { checks?: unknown }).checks : undefined;
  const result = PackChecksSchema.safeParse(checks === undefined ? {} : checks, { error: _namingRefusedValue });
  if (!result.success) throw new Error(result.error.issues.map(issue =>
    `apack.json checks${issue.path.length ? '.' + issue.path.join('.') : ''}: ${issue.message}`).join('\n'));
  const allowed = new Set<PackRuleKey>(result.data.allow ?? []);
  const rules = PACK_RULES.filter((rule) => !allowed.has(rule.key));
  const problems = new Map<PackRuleKey, string[]>();
  /**
   * The offences a whole-pack rule claimed, so a per-file rule does not report one of them a second time.
   *
   * `file\0line\0what` — the offence, not the line of output: a closure finding's line carries a
   * `(reached from …)` suffix that the per-file rule reporting the same import would not write. And not the
   * `file:line` alone, because two specifiers do share a line and they are two offences.
   *
   * Byte spans are what the per-file pass compares, and a whole-pack finding has none, which is why this is the
   * one place the two kinds are matched on a site rather than a span. Measured before this existed: a contract
   * leaf importing another feature's frontend was reported by `contract-leaves` and by `cross-feature-imports`,
   * identically, and `apack pack validate` printed both.
   */
  const claimedWide = new Set<string>();
  const site = (file: string, line: number, subject: string) => `${file}\u0000${line}\u0000${subject}`;
  for (const rule of rules) {
    const found = rule.checkPack?.(packDir) ?? [];
    for (const finding of found) {
      if (finding.at?.line !== undefined) claimedWide.add(site(finding.at.file, finding.at.line, finding.subject ?? finding.what));
    }
    const lines = found.map((finding) => formatPackWide(finding));
    if (lines.length > 0) problems.set(rule.key, [...(problems.get(rule.key) ?? []), ...lines]);
  }
  for (const { view, place } of packPlaces(packDir, dirs)) {
    const claimed: { start: number; end: number }[] = [];
    for (const rule of rules) {
      const kept = (rule.check?.(view, place) ?? []).filter((finding) => {
        // A whole-pack rule already reported this offence. Its span goes into `claimed` all the same, so a third
        // rule reporting the import around it stands down too — the site is taken, not just this wording of it.
        if (claimedWide.has(site(place.packRelative, finding.line, finding.subject ?? finding.what))) {
          claimed.push({ start: finding.start, end: finding.end });
          return false;
        }
        // Overlapping a span an earlier rule claimed, so it is the same offence seen another way. Overlap
        // rather than containment, because the spans nest both ways: `host-imports` reports the specifier and
        // `internal-package-imports` the whole import around it, so a containment test would let whichever
        // rule reported the *wider* span win regardless of the order declared below.
        if (claimed.some(({ start, end }) => finding.start < end && start < finding.end)) return false;
        claimed.push({ start: finding.start, end: finding.end });
        return true;
      });
      if (kept.length > 0) {
        problems.set(rule.key, [...(problems.get(rule.key) ?? []),
          ...kept.map(({ line, what }) => `${place.packRelative}:${line}: ${what}`)]);
      }
    }
  }
  return problems;
}

/**
 * Throws naming every rule that fired, or returns.
 *
 * Every rule, not the first: a pack author fixes them in one pass rather than in one build each. A switchable
 * rule's block ends with the line that allows it, and a rule that is not switchable does not offer one,
 * because manifest validation refuses the key.
 */
export function refusePackRuleViolations(packDir: string, dirs?: readonly string[]): void {
  const problems = packRuleProblems(packDir, dirs);
  if (problems.size === 0) return;
  const blocks = [...problems].map(([key, found]) => {
    const rule = PACK_RULES.find((candidate) => candidate.key === key) as PackRule;
    const lines = [`  ${rule.rule}:`, ...found.map((problem) => `    - ${problem}`)];
    if (rule.switchable) lines.push(`    to allow this, put { "checks": { "allow": ["${key}"] } } in apack.json`);
    return lines.join('\n');
  });
  throw new Error(`${problems.size} pack rule${problems.size === 1 ? '' : 's'} failed.\n\n${blocks.join('\n\n')}`);
}
