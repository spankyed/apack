// What a chain step's cache key leaves out, and what a suite has to declare because of what its specs read.
//
// A sibling question to `chain-inputs.spec.ts`, which asks whether a step's declared inputs cover the files
// that step reads. This asks the two rules above that: a `CLAUDE.md` is never in a cache key, so prose costs
// nothing, except the one guide a spec asserts the text of; and a suite holding a guard whose subject is the
// whole repo declares the whole repo, or the pool skips that suite's project while the thing it guards moves.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { covers, GUIDES_A_CHECK_READS, inputFiles, READS_MARKDOWN, REPO_ROOT, skipsFingerprint } from '@apackdev/host/build/packages-built';
import { CHAIN_STEPS, SUITE_READS, type ChainStep } from '../../../scripts/lib/chain-steps.ts';
import { repoFiles } from './_support/repo-files.ts';

/** The walk under one declared path, memoised: every case here asks for the same paths. */
const walked = new Map<string, readonly string[]>();
const filesUnder = (input: string): readonly string[] => {
  const found = walked.get(input) ?? inputFiles(path.join(REPO_ROOT, input));
  walked.set(input, found);
  return found;
};

/**
 * A CLAUDE.md edit runs nothing. That is the first entry in the root CLAUDE.md's list of time-wasters, and
 * it is first because it is the one most often ignored — but it was a claim about the chain that the chain
 * did not hold: five guides sit inside a declared `src/` or `tests/` tree rather than at a package root, so a
 * sentence of prose re-ran up to four steps, `build:default-setup` among them. `fingerprintUnit` skips them now, and this
 * is the claim itself, asserted rather than believed.
 *
 * Checked through `fingerprintWithDigests`, which is the hash a step's cache key is taken over, so this and
 * the cache cannot disagree about what counts as an input.
 */
/**
 * A guard whose subject is the repo has to be an input to the repo.
 *
 * These live inside one package's suite — `identity-guard` in `@apackdev/sdk`, six here — while what they
 * assert is every tracked file. The pool runs a project only when that project's own inputs moved, so each
 * was blind to the rest of the tree: `@apackdev/sdk`'s suite was an input to 241 of 1860 tracked code files.
 * It missed a forbidden path committed to `@apackdev/cli`, which is not one of its dependencies, and two full
 * chain runs passed over it. `SUITE_READS`' `repo` flag is the fix; this is what keeps it applied.
 *
 * The subject is derived from the specs themselves, through the AST: a spec that calls `repoFiles` is
 * asking what the repo holds, whatever it then does with the answer. That one call is the whole signal
 * because `check:specifiers`' `findRawGitListings` refuses a spec that asks git directly, so `repoFiles`
 * is the only way left to ask — and matching the string `ls-files` too made this file look like one.
 */
describe('a guard over the whole repo', () => {
  const asksWhatTheRepoHolds = (file: string): boolean => {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.ESNext, true);
    let asks = false;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'repoFiles') asks = true;
      ts.forEachChild(node, visit);
    };
    visit(source);
    return asks;
  };

  /** The suites holding one, by the suite directory `SUITE_READS` is keyed on. */
  // Memoised: both cases below ask for the same answer, and taking it parses every spec in the repo.
  let suites: string[] | undefined;
  const repoWide = (): string[] => suites ??= [...new Set(repoFiles('packages')
    .filter((file) => file.endsWith('.spec.ts') && file.includes('/tests/'))
    .filter((file) => asksWhatTheRepoHolds(path.join(REPO_ROOT, file)))
    .map((file) => file.split('/')[1]!))].sort();

  it('found some, so this is not looking at nothing', () => {
    expect(repoWide()).not.toEqual([]);
  });

  it('declares every suite that holds one, and no suite that does not', () => {
    const declared = Object.entries(SUITE_READS).filter(([, reads]) => reads.repo).map(([dir]) => dir).sort();
    expect(declared, 'a suite holding a repo-wide guard needs `repo: true` in SUITE_READS, or the pool skips '
      + 'its project while the thing it checks moves; one with none should drop the flag, which is making '
      + 'every change re-run it for nothing').toEqual(repoWide());
  });
});

describe('prose costs nothing', () => {
  const guides = (): string[] => repoFiles().filter((file) => path.basename(file) === 'CLAUDE.md');
  /** Every tracked markdown file, which is what the rule is about since 2026-10-05 */
  const markdown = (): string[] => repoFiles().filter((file) => file.endsWith('.md'));
  const underAContentTree = (file: string): boolean =>
    file.split('/').some((segment) => READS_MARKDOWN.has(segment));

  /**
   * Every file in a step's fingerprint, which is what its cache key is taken over — the walk the hash is
   * taken over, filtered the two ways the hash filters it. Not the hash itself: taking twelve real
   * fingerprints to ask which files are in them cost 1.5s, and `skipsFingerprint` is the same rule rather
   * than a second copy of it.
   */
  const fingerprinted = (step: ChainStep): Set<string> => {
    const out = [...(step.outputs ?? []), ...(step.excludes ?? [])];
    return new Set(step.inputs
      .flatMap((input) => filesUnder(input))
      .filter((file) => !skipsFingerprint(file) && !out.some((excluded) => covers(excluded, file))));
  };

  it('found the guides, so this is not looking at nothing', () => {
    expect(guides().length, 'every package has one').toBeGreaterThan(10);
  });

  /**
   * Where a guide is in some step's cache key, which it should be only when a check asserts its text.
   *
   * Memoised because it hashes every input of all twelve steps, which is 1.4s — and both cases below ask
   * the same question of the same tree, so taking it twice doubled this file's cost for one answer.
   */
  let where: Map<string, string[]> | undefined;
  const costing = (): Map<string, string[]> => {
    if (where) return where;
    where = new Map<string, string[]>();
    for (const step of CHAIN_STEPS) {
      const inside = fingerprinted(step);
      for (const guide of guides().filter((g) => inside.has(g))) where.set(guide, [...(where.get(guide) ?? []), step.name]);
    }
    return where;
  };

  it('keeps every CLAUDE.md out of every step\'s cache key', () => {
    const costly = [...costing()]
      .filter(([guide]) => !GUIDES_A_CHECK_READS.has(guide))
      .map(([guide, steps]) => `${guide} -> ${steps.join(', ')}`);
    expect(costly, 'editing one of these re-runs a step for a sentence of prose. If a check now asserts a '
      + "guide's text it is a real input: add it to GUIDES_A_CHECK_READS in packages-built.ts, and to the "
      + 'inputs of the step that runs that check').toEqual([]);
  });

  /**
   * And the same of prose that is not named `CLAUDE.md`, which is what the rule was widened to cover.
   *
   * It was a rule about one filename, so four files that are plainly documentation — two `README.md` and an
   * example under `default-setup/src/features/` — cost 9 steps each for a typo. Measured 2026-10-05, before:
   * 176 tracked markdown files were in some step's key; after, 172, and the four are the difference.
   */
  it('keeps prose that is not a guide out of every step\'s cache key', () => {
    const costly: string[] = [];
    for (const step of CHAIN_STEPS) {
      const inside = fingerprinted(step);
      for (const file of markdown()) {
        if (underAContentTree(file) || GUIDES_A_CHECK_READS.has(file) || !inside.has(file)) continue;
        costly.push(`${file} -> ${step.name}`);
      }
    }
    expect([...new Set(costly.map((row) => row.split(' -> ')[0]!))],
      'a step keys on these and nothing reads them. If something now does, put the directory in '
      + 'READS_MARKDOWN; if a check asserts the text, GUIDES_A_CHECK_READS is the other half').toEqual([]);
  });

  /**
   * The other direction, and the one that fails silently: an exemption protects nothing unless the guide is
   * actually in a step's fingerprint. It was not — `WORKSPACE_PARTS` lists a package's subparts and not its
   * root, so `packages/repo-checks/CLAUDE.md` sat outside every input while a spec asserted its contents.
   */
  it('has each exempted guide in a step, so the exemption protects something', () => {
    const lapsed = [...GUIDES_A_CHECK_READS].filter((guide) => !(costing().get(guide) ?? []).length);
    expect(lapsed, 'these are exempted from the skip but in no step, so the check that reads them can run '
      + 'cached over a stale doc. Add each to the inputs of the step that runs that check, or drop it from '
      + 'GUIDES_A_CHECK_READS').toEqual([]);
  });

  /**
   * The other half, and the silent one: markdown something *reads* must stay in the key.
   *
   * **Its subject cannot come from `READS_MARKDOWN`, which is the rule under test.** Written that way first
   * and it could not fail: drop `etc` from the list and the case asking "is content skipped" no longer counts
   * an API report as content, so three cases passed over a rule that had stopped protecting the reports
   * `api:check` compares. The subject has to be a fact that holds whatever the rule says — so it is one real
   * file per tree, named with the step that must key on it, and an entry whose file has moved is reported.
   */
  const CONTENT_IN_A_KEY: Record<string, string> = {
    // A hand-edited report is the one hole the deleted API stamp could not see, so `api:check` keys on them
    'packages/apack-sdk/etc/index.api.md': 'api:check',
    // The same hole in the pack's facade report, which the `facade:check` step compares against. `build:default-setup`
    // declares it too — the build reads it to warn — but the step that fails on it is the one named here
    'packages/default-setup/etc/pack-types.api.md': 'facade:check',
    // Content sources compile into the rows a user gets
    'packages/default-setup/src/content/notes/welcome.md': 'build:default-setup',
    'packages/default-setup/src/extensions/help/github-sign-in.md': 'build:default-setup',
    // The CLI's scaffold, rendered into a new pack and read by the specifier rules
    'packages/apack-cli/templates/pack/README.md': 'check:specifiers',
    // Test input, read by the content-parity goldens
    'packages/default-setup/tests/_support/fixtures/content-parity/v1/notes/welcome.md': 'test:unit:pack',
    // The document tree `doc-links` resolves every relative link in. A dead link fails nothing on its own,
    // so this has to be in the key of the step that runs that check or it caches over a doc that moved
    'docs/public-facing/manifest.md': 'test:unit:host',
  };

  it('keeps markdown a build reads in the key of the step that reads it', () => {
    const lost = Object.entries(CONTENT_IN_A_KEY).flatMap(([file, stepName]) => {
      if (!markdown().includes(file)) return [`${file}: no longer tracked, so this row checks nothing`];
      const step = CHAIN_STEPS.find((candidate) => candidate.name === stepName);
      if (step === undefined) return [`${file}: no step named ${stepName}`];
      return fingerprinted(step).has(file) ? [] : [`${file} left ${stepName}'s key, so it can cache over a change to it`];
    });
    expect(lost, 'something reads or ships these; a tree missing from READS_MARKDOWN is how they go quiet')
      .toEqual([]);
  });

  it('covers every tree in the list, so no entry is checked over nothing', () => {
    const uncovered = [...READS_MARKDOWN]
      .filter((tree) => !Object.keys(CONTENT_IN_A_KEY).some((file) => file.split('/').includes(tree)))
      .map((tree) => `${tree}: no row above names a file under it, so dropping it would fail nothing`);
    expect(uncovered).toEqual([]);
  });

  /** Two guides sit inside a content tree, and the first draft of the widened rule started keying on them */
  it('still treats a guide inside a content tree as prose', () => {
    for (const guide of ['packages/default-setup/src/content/CLAUDE.md', 'packages/default-setup/tests/content/CLAUDE.md']) {
      expect(guides(), `${guide} moved, so this case is about nothing`).toContain(guide);
      expect(skipsFingerprint(guide), `${guide} is in a key for a sentence of prose`).toBe(true);
    }
  });

  // The subject is a walk, and a walk that reaches nothing reports no offence. The guide this once cost the
  // most for is the case: it is in `build:default-setup`'s declared tree, so only the skip keeps it out.
  it('would see one that was in a step, so the rule above can fail', () => {
    const content = 'packages/default-setup/src/content/CLAUDE.md';
    expect(guides(), content).toContain(content);
    const compile = CHAIN_STEPS.find((step) => step.name === 'build:default-setup')!;
    expect([...fingerprinted(compile)].some((file) => file.startsWith('packages/default-setup/src/content/')),
      'build:default-setup no longer reads the tree that guide sits in, so this case proves nothing').toBe(true);
  });
});