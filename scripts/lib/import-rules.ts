/**
 * What a rule is: its shape, whether a pack is held to it too, and the one way this repo runs a pack rule.
 *
 * The definition, not the rules — `scripts/check-import-specifiers.ts` names the eighteen and pairs each with
 * the function that finds it. Nothing here names a rule, which is what lets the list live beside the finders
 * and the vocabulary live here.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatPackWide, PACK_RULES, packPlaces, type PackRuleKey } from '../../packages/apack-cli/src/build/pack-rules.ts';
import { packRootOf, repoRelative, repoRoot } from './import-populations.ts';

/** The pack rule `key` names. One lookup, because a key naming no rule is the same mistake wherever it is made */
function packRuleFor(key: PackRuleKey) {
  const rule = PACK_RULES.find((candidate) => candidate.key === key);
  if (!rule) throw new Error(`No pack rule "${key}"`);
  return rule;
}

/** The sentence a pack rule reports, read from the rule itself so this script prints what a pack author is told */
const ruleSentence = (key: PackRuleKey): string => packRuleFor(key).rule;

/**
 * A pack rule from `@apackdev/cli`'s `build/pack-rules.ts`, applied to this repo's packs.
 *
 * The rule is the same rule wherever it runs — `apack pack build`, `apack pack validate` and `apack pack test` run these
 * for every pack outside this checkout, and running a second implementation here is how two copies of one rule
 * drift apart (`docs/goals/goal-one-rule-set.md`). What this adds is the repo's shape: each `dir` may be a
 * pack's `src`, a pack's `tests`, or — in a spec — a directory standing in for one, and paths are reported
 * relative to the repo rather than to the pack.
 *
 * One rule at a time, so it does not get `packRuleProblems`' "one offence, one message" — there, a pack author
 * reading a build failure is told once by the rule whose cause comes first. Here the rule *is* the subject:
 * `--rule <id>` runs one; `--list` names them all, says which an external pack is held to as well (a rule with
 * a `packRule` is one `apack pack validate`, `build` and `test` run), and prints what doing without each of the
 * rest costs a pack — answering from the entries rather than from a table in a doc, which is what a survey of
 * this taken by hand went stale as. A rule that stood down would make a per-rule run's
 * answer depend on which other rules ran. What keeps that from becoming two answers to one question is that
 * both run the same rule — its `check` per file, its `checkPack` once for the pack — and `FIRES`' disjointness
 * sweep asserts no two rules claim one offence to begin with, for every rule this delegates to.
 */
export function packRule(key: PackRuleKey, dirs: readonly string[], root: string): string[] {
  const rule = packRuleFor(key);
  // A rule whose subject is the pack answers once per pack, not once per directory of it: `dirs` holds a pack's
  // `src` and its `tests` separately, and the CLI's own runner calls such a rule once per pack too. Its findings
  // are written relative to the pack, as a pack author reads them, so here they take the pack's own prefix.
  const packs = new Set(dirs.map((dir) => path.join(root, dir)).filter(fs.existsSync).map((full) => packRootOf(full, root)));
  // A whole-pack rule names places relative to its pack, as a pack author reads them; this repo has five packs,
  // so a finding says which one. `formatPackWide` writes the line and takes the path from here, which is why this
  // needs to know nothing about how any rule words its findings.
  const wholePack = rule.checkPack === undefined ? [] : [...packs].flatMap((packDir) => {
    const prefix = repoRelative(root, packDir);
    const where = (file: string) => (prefix ? `${prefix}/${file}` : file);
    return rule.checkPack!(packDir).map((found) => formatPackWide(found, where));
  });
  // Through `packPlaces`, not a second copy of it: a copy's fields drift from what `PackPlace` declares,
  // and a drifted field turns a rule off without failing anything. What stays here is the one thing that is this runner's own: the
  // path it prints, which is repo-relative because that is where its reader is standing.
  return [...wholePack, ...dirs.flatMap((dir) => {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) return [];
    const packDir = packRootOf(full, root);
    return packPlaces(packDir, [path.relative(packDir, full)]).flatMap(({ view, place }) => {
      const shown = repoRelative(root, path.join(packDir, place.packRelative));
      return (rule.check?.(view, place) ?? []).map(({ line, what }) => `${shown}:${line}: ${what}`);
    });
  })].sort();
}

/**
 * What a rule is: the sentence it reports, and — for the rules that can answer about one file at a time — how
 * to run it over paths a caller names.
 *
 * `overPaths` is what makes `npm run check:specifiers <paths…>` honest: a rule that reads the whole tree (the
 * layer manifests, the config scan, the stale-exception checks) declares none, and a per-file run says which
 * rules it skipped rather than reporting a pass it did not earn.
 *
 * The runner and the specs read one list of these (`CHECKS`), and `import-specifiers.integration.spec.ts`
 * asserts each entry has a case that makes it fire — which is what stops a check landing with nothing
 * exercising it.
 */
interface RuleShape {
  /** Stable name, the one the spec's FIRES table is keyed by and `--rule` takes */
  readonly id: string;
  /** The sentence reported when it fires */
  readonly rule: string;
  /** Over the whole repo */
  find(): string[];
  /** Over paths a caller names, when the rule can answer per file */
  overPaths?(paths: readonly string[], root?: string): string[];
  /**
   * The directories the whole-tree run reads, for a rule whose subject is a tree rather than the checkout.
   *
   * Data rather than a default parameter, because two checks need to read it: the sweeps that assert one rule owns
   * each offence derive who takes part from it — a rule that reads a pack's `tests` is swept there, and one that
   * reads `packages/*` minus the packs takes part in neither — and a population is otherwise unassertable, which is
   * how `host-imports` came to read a pack's `src` alone while `apack pack test` ran it over a pack's tests.
   *
   * Absent for the six rules whose subject is not a dir list: the layer table, `ELMDB_RULES`, the shared-list files,
   * the repo's configs, a package's own `scripts/` and the checkout itself.
   */
  readonly over?: readonly string[];
}

/**
 * A rule, which says who owns it: `@apackdev/cli`, or this repo.
 *
 * A union rather than two optional fields, so a rule that says both or neither does not compile. Two pack-subject
 * rules sat in this script for months while an external pack was held to neither, and the reasons they had not
 * moved lived in an archived goal doc that nothing reads; this is the cheapest place to make the next one answer
 * the question — at the declaration, before anything runs, rather than in a case that has to be remembered.
 */
export type PackParity =
  /** The pack-facing half is a named pack rule, so an external pack is held to the same thing by another name */
  | { readonly kind: 'covered'; readonly by: PackRuleKey; readonly note: string }
  /** A pack cannot commit this offence: it has no `scripts/` of its own, is not an `@apackdev/*` package, and so on */
  | { readonly kind: 'inapplicable'; readonly note: string }
  /**
   * A pack *can* commit it and nothing outside this repo refuses it.
   *
   * The variant exists so that the next such rule has somewhere honest to go. Without it, whoever adds one
   * reaches for `inapplicable` — a claim no check can contradict — and the gap reopens silently, which is how
   * `findRepositoryCasts` sat here holding built-in packs to a rule external packs were free of.
   */
  | { readonly kind: 'unenforced'; readonly note: string };

export type ImportRule = RuleShape & (
  /** The CLI owns the implementation; `backed` sets this */
  { readonly packRule: PackRuleKey; readonly repoOnly?: never }
  /** Why this rule's subject is this repo rather than a pack, as an answer a reader can check rather than prose */
  | { readonly packRule?: never; readonly repoOnly: PackParity }
);

/**
 * A rule `@apackdev/cli` owns, applied to the packs in this checkout: one body of code, one sentence, two entry
 * points. `find` takes the rule's own population and `overPaths` the paths a caller named, both through the same
 * function.
 *
 * The sentence comes from `PACK_RULES` rather than being written again here, because a second copy drifts: for a
 * while `host-imports` printed one sentence from `apack pack validate` and a different one from `check:specifiers`,
 * for the same offence in the same file.
 */
export const backed = <Id extends string>(
  id: Id,
  key: PackRuleKey,
  find: (dirs?: readonly string[], root?: string) => string[],
  over: readonly string[],
) => ({
  id,
  packRule: key,
  rule: ruleSentence(key),
  over,
  find: () => find(over),
  overPaths: (paths: readonly string[], root = repoRoot) => find(paths, root),
}) satisfies ImportRule;
