// Every tracked source file is an input to some chain step, or is named here with a reason. Caching a step
// on its declared inputs is only as sound as that list: a file no step names is a file whose change skips
// every check, silently, and with CI off the chain is the only gate. `BUILD_UNITS` never needed this —
// it covers five packages whose builds read their own trees — where a chain step reads whatever its script
// happens to reach, which is not visible from the step's name.
//
// It asks git rather than walking the tree, so an ignored file is not mistaken for an untracked source, and
// resolves a step's inputs through `inputFiles` — the walk a fingerprint is taken over — so the guard and
// the cache key cannot disagree about what an input covers.
//
// `BUILD_UNITS` gets the same treatment at the bottom of this file, and used to be excused from it here on
// the grounds that it "covers five packages whose builds read their own trees". That was not true: a build
// script imports modules, and three units were missing the one their staging is derived from.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { population } from '@apackdev/sdk/testing';
import { BUILD_UNITS, covers, excludedBySuffix, fingerprintUnit, inputFiles, NOT_A_BUILD_INPUT, REPO_ROOT, repoRelative, type TreeReader } from '@apackdev/host/build/packages-built';
import { PUBLISH_TREE } from '@apackdev/host/build/published-manifest';
import { CHAIN_STEPS, dependsOn, suiteInputs, SUITE_READS, WORKSPACE_PARTS, type ChainStep } from '../../../scripts/lib/chain-steps.ts';
import { UNIT_SUITES } from '../../../scripts/lib/unit-suites.ts';
import { reachableFrom } from '../../../scripts/lib/module-graph.ts';
import { commandText, reachableText, rootScripts } from '../../../scripts/lib/npm-scripts.ts';
import { TYPECHECK_LEGS } from '../../../scripts/lib/typecheck-legs.ts';
import { PACKAGE_DIRS } from '../../../scripts/lib/workspace-deps.ts';
import { closureOf } from './_support/module-closure.ts';
import { repoFiles } from './_support/repo-files.ts';

/** Tracked code no chain step reads, and why. An entry that stops applying is reported, not ignored. */
const NOT_A_CHAIN_INPUT: Record<string, string> = {
  'tests/fixtures/claude-research/linux-app.sh': 'used only by explicitly invoked original-Claude Linux acceptance, outside the chain',
  // The production packaging and release path. The chain builds the app (`build:runtime`) and never packages,
  // signs or releases it, so none of this runs in any step — listed per file rather than as a `build/`
  // prefix so that something chain-relevant landing there has to be noticed.
  'build/build.sh': 'npm run build:production; packaging, which no chain step does',
  'build/release/release.sh': 'the release path, which the chain never runs',
  'build/release/beta-tag.sh': 'the release path; its rule is covered by release-beta-rule.test.sh',
  'build/release/unrelease.sh': 'the release path',
  'build/resources/gen-icons.sh': 'regenerates committed icons by hand',
  'native/speech/macos/build.sh': 'builds the native speech helper, which build:production invokes',
};

// `.sh` included: three of the chain's steps *are* shell scripts, so leaving the extension out meant the
// coverage claim skipped the files that drive the app entirely.
const CODE = /\.(ts|tsx|vue|mts|cts|mjs|cjs|js|sh)$/;

const trackedCode = (): string[] =>
  repoFiles().filter((file) => CODE.test(file));

/**
 * The walk under one declared path, memoised for this file.
 *
 * Nine call sites ask for the same paths — four whole-chain coverage sweeps and the guide checks — and the
 * repo-wide suites declare every source tree, so the same directories were walked over and over. Safe to
 * memoise here and nowhere else: a spec run is one moment, and nothing in it writes to the tree.
 */
const walked = new Map<string, readonly string[]>();
const filesUnder = (input: string): readonly string[] => {
  const found = walked.get(input) ?? inputFiles(path.join(REPO_ROOT, input));
  walked.set(input, found);
  return found;
};

/**
 * Every tracked file the steps' inputs reach, resolved the way a fingerprint resolves them.
 *
 * `excludeSuffixes` included, through the predicate the key itself uses: a step that declares a tree and
 * says it reads one kind of file out of it does not cover the rest, and a guard that thought otherwise would
 * report a module as declared while the step cached straight past it.
 */
const coveredBy = (steps: readonly Pick<ChainStep, 'inputs' | 'excludeSuffixes'>[]): Set<string> => {
  const covered = new Set<string>();
  for (const step of steps) {
    for (const input of step.inputs) {
      for (const file of filesUnder(input)) {
        if (!excludedBySuffix(step.excludeSuffixes, file)) covered.add(file);
      }
    }
  }
  return covered;
};



describe('the chain reads every source file', () => {
  it('covers every declaration-program root in pack build and facade freshness', () => {
    const directory = path.join(REPO_ROOT, 'packages/default-setup');
    const read = ts.readConfigFile(path.join(directory, 'tsconfig.json'), ts.sys.readFile);
    expect(read.error).toBeUndefined();
    const config = ts.parseJsonConfigFileContent(read.config, ts.sys, directory);
    expect(config.errors).toEqual([]);
    population('pack declaration roots', config.fileNames, { atLeast: 100 });
    for (const name of ['build:default-setup', 'facade:check']) {
      const step = CHAIN_STEPS.find(step => step.name === name)!;
      const covered = coveredBy([step]);
      const missing = config.fileNames.map(file => path.relative(REPO_ROOT, file).split(path.sep).join('/'))
        .filter(file => !covered.has(file));
      expect(missing, `${name} must invalidate when a captured declaration root changes`).toEqual([]);
    }
  });

  it('has no tracked code that no step names', () => {
    const covered = coveredBy(CHAIN_STEPS);
    const missing = trackedCode().filter((file) => !covered.has(file) && !(file in NOT_A_CHAIN_INPUT));
    expect(missing, 'add these to a step\'s inputs, or to NOT_A_CHAIN_INPUT with a reason').toEqual([]);
  });

  // A list of exceptions is only honest while each one is still an exception
  it('lists no exception that has stopped applying', () => {
    const covered = coveredBy(CHAIN_STEPS);
    const stale = Object.keys(NOT_A_CHAIN_INPUT).filter((file) => {
      if (!fs.existsSync(path.join(REPO_ROOT, file))) return true;
      return covered.has(file);
    });
    expect(stale, 'these are gone or are now a step input; drop them from NOT_A_CHAIN_INPUT').toEqual([]);
  });

  // Coverage is repo-wide: it proves *some* step reads a file, not that the right one does. Steps overlap
  // honestly — `typecheck` reads `tests/` because it compiles the E2E specs — so dropping `tests/e2e` from
  // the E2E step leaves it covered and the check above green. This is the per-step half, and it is what can
  // be derived: a path the step *reaches* is a path that step reads, so it must be an input.
  //
  // Reaches, not names. This used to scan the step's own script text for a `tests/` or `scripts/` path, which
  // sees nothing through a delegation: `facade:check` is `npm run facade:check -w @app/default-setup`, and
  // while that script named a repo file rather than a CLI command, the file went undeclared for a commit.
  // `reachableText` follows
  // `npm run`, `-w` and the files a script names, and is the same walk `check:tiers` uses for its own
  // question.
  /**
   * A linter walks a directory, so the files it reads are not the files its command names — `oxlint .` names one
   * path and reads a hundred. `reachableText` answers what a script *names*, which is the right answer to its own
   * question and no answer to this one, so the case above sees nothing here: it also cannot follow into
   * `TYPECHECK_LEGS`, because the legs are data this imports rather than text a script spells.
   *
   * Measured before this existed: the root `lint:check` grew from `oxlint scripts tests` to `oxlint .` minus two
   * directories, which took in three packaging modules that `typecheck` did not declare — so an unused binding in
   * `scripts/packaged-app.ts` failed `lint:check` while the chain planned `typecheck` as cached.
   *
   * `lint:check` lints in two passes and both are derived here. The root one is `oxlint .` minus `docs/**` and
   * the CLI's scaffold templates (`lint-scope.spec.ts` holds that second exclusion, which nothing else reads —
   * this case does not, because `typecheck` declares `templates` among its inputs whether it is linted or not);
   * the other is the script run in each workspace, from that package's directory — which is why a
   * target resolves against a base rather than the repo root. Expanding a script's text is not enough to see the
   * second: the root script's own first clause *is* the fan-out, and `expanded` substitutes each `npm run` once,
   * so the workspace passes stayed invisible and a package-root `.mjs` no step declared went unnoticed until
   * someone read the command by hand.
   *
   * Everything a pass depends on is derived from the thing that decides it, because a pass this cannot see is a
   * pass nothing checks and there is no assertion that catches the *absence* of one. So the workspaces come from
   * the root `workspaces` field rather than a listing of `packages/` that agrees with it today, and both
   * spellings of the fan-out are followed — `-ws` over all of them and `-w <name>` over the ones it names.
   *
   * Derived from the command, not restated: the targets and the `--ignore-pattern`s are parsed out of the same
   * string the leg runs, so narrowing the lint scope narrows what this demands. A shape it cannot read fails
   * rather than passing over whatever it did not understand. The one thing it reads and discards is
   * `--ignore-path .gitignore`, because everything it considers comes from `git ls-files` and a gitignored file
   * is not tracked; any other ignore file is exclusions it cannot account for, and fails.
   *
   * The renderer's `&& eslint .` half is not derived — its ignores live in `eslint.config.ts`, not in the
   * command — and it needs no derivation: it walks the tree the oxlint call in that same script already covers.
   */
  it('gives the step that lints the files its linter walks', () => {
    const all = rootScripts();
    /** A leg's command with each `npm run <name>` it spells expanded once, which is where the oxlint call lives */
    const expanded = (command: string): string => command.replace(/npm run ([\w:-]+)/g, (whole, name: string) => all[name] ?? whole);
    const VALUED = new Set(['-D', '--deny', '-A', '--allow', '-W', '--warn', '-c', '--config', '--ignore-path', '--ignore-pattern']);
    // What oxlint parses, which is narrower than `CODE`: a shell script is tracked code and no linter's input
    const LINTS = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|vue)$/;
    const lintable = trackedCode().filter((file) => LINTS.test(file));
    const clauses = (command: string): string[] => command.split('&&');
    const isOxlintCall = (clause: string): boolean => /(^|\s)oxlint(\s|$)/.test(clause);

    /** The tracked files one oxlint call walks. `base` is the package directory it runs from, empty at the root */
    const walkedBy = (call: string, base: string): Set<string> => {
      const tokens = call.trim().split(/\s+/);
      const args = tokens.slice(tokens.indexOf('oxlint') + 1);
      const targets: string[] = [];
      const ignores: string[] = [];
      for (let i = 0; i < args.length; i += 1) {
        const arg = args[i]!;
        if (VALUED.has(arg)) {
          const value = args[i + 1];
          expect(value, `\`${arg}\` ends \`${call.trim()}\` with nothing to read`).toBeDefined();
          if (arg === '--ignore-pattern') ignores.push(value!.replace(/^['"]|['"]$/g, ''));
          if (arg === '--ignore-path') expect(value, `this only reads \`--ignore-path .gitignore\`, whose exclusions are already absent from git ls-files`).toBe('.gitignore');
          i += 1;
          continue;
        }
        if (!arg.startsWith('-')) targets.push(arg);
      }
      expect(targets, `no target read out of \`${call.trim()}\``).not.toEqual([]);
      const under = (relative: string): string => (relative === '.' ? base : base === '' ? relative : `${base}/${relative}`);
      const prefixes = targets.map(under);
      const ignored = ignores.map((pattern) => {
        const dir = /^([\w./-]+)\/\*\*$/.exec(pattern)?.[1];
        expect(dir, `this only reads a \`dir/**\` ignore pattern, and got \`${pattern}\``).toBeDefined();
        return `${under(dir!)}/`;
      });
      const walked = new Set<string>();
      for (const file of lintable) {
        if (!prefixes.some((prefix) => prefix === '' || file === prefix || file.startsWith(`${prefix}/`))) continue;
        if (ignored.some((prefix) => file.startsWith(prefix))) continue;
        walked.add(file);
      }
      return walked;
    };

    // The one definition of which workspaces there are, which refuses a glob whose workspaces it could not name
    const workspaces = PACKAGE_DIRS.map((dir) => `packages/${dir}`);
    expect(workspaces, 'no workspace was derived, so every workspace pass would be invisible').not.toEqual([]);
    const manifests = new Map(workspaces.map((workspace) => [
      workspace,
      JSON.parse(fs.readFileSync(path.join(REPO_ROOT, workspace, 'package.json'), 'utf-8')) as { name?: string; scripts?: Record<string, string> },
    ]));

    /** The script a clause fans out, and the workspaces it reaches; `undefined` when the clause fans out nothing */
    const fanOut = (clause: string): { readonly script: string; readonly at: readonly string[] } | undefined => {
      const script = /npm run ([\w:-]+)/.exec(clause)?.[1];
      if (script === undefined) return undefined;
      if (/(^|\s)(-ws|--workspaces)(\s|$)/.test(clause)) return { script, at: workspaces };
      const named = [...clause.matchAll(/(?:^|\s)(?:-w|--workspace)\s+(\S+)/g)].map((match) => match[1]!);
      if (named.length === 0) return undefined;
      return {
        script,
        at: named.map((one) => {
          const found = workspaces.find((workspace) => manifests.get(workspace)!.name === one);
          expect(found, `\`-w ${one}\` names no workspace`).toBeDefined();
          return found!;
        }),
      };
    };

    const passes: { readonly at: string; readonly call: string; readonly files: Set<string> }[] = [];
    for (const leg of TYPECHECK_LEGS) {
      for (const clause of clauses(expanded(leg.command))) {
        if (isOxlintCall(clause)) passes.push({ at: '', call: clause, files: walkedBy(clause, '') });
        const fan = fanOut(clause);
        if (fan === undefined) continue;
        for (const workspace of fan.at) {
          const script = manifests.get(workspace)!.scripts?.[fan.script];
          if (script === undefined) continue;
          for (const call of clauses(script).filter(isOxlintCall)) passes.push({ at: workspace, call, files: walkedBy(call, workspace) });
        }
      }
    }

    // Per pass, never per total: the workspace passes are nine tenths of the files, so a floor over the sum
    // would be cleared by the root pass alone if the fan-out silently stopped expanding — which is the way
    // this went wrong before it derived the fan-out at all.
    for (const pass of passes) {
      expect(pass.files.size, `\`${pass.call.trim()}\`${pass.at === '' ? '' : ` in ${pass.at}`} derived no file, so it demands nothing`).toBeGreaterThan(0);
    }
    expect(passes.some((pass) => pass.at === ''), 'no root oxlint call was derived').toBe(true);
    expect(passes.some((pass) => pass.at !== ''), 'no workspace oxlint call was derived — the fan-out stopped being followed').toBe(true);

    const linted = new Set(passes.flatMap((pass) => [...pass.files]));
    // `lint:check` is its own chain step now; it was a leg of `typecheck` when this case was written
    const step = CHAIN_STEPS.find((candidate) => candidate.name === 'lint:check')!;
    expect(step, 'no step runs the lint, so this would pass over nothing').toBeDefined();
    const covered = coveredBy([step]);
    const missing = [...linted].filter((file) => !covered.has(file)).sort();
    expect(missing, 'lint:check walks these and declares none of them, so it caches over their changes').toEqual([]);
  });

  it('rebuilds the app when its host implementations change', () => {
    const step = CHAIN_STEPS.find(candidate => candidate.name === 'build:runtime')!;
    const host = 'packages/apack-host/';
    const reached = closureOf([
      path.join(REPO_ROOT, host, 'src/fe/index.ts'),
      path.join(REPO_ROOT, host, 'src/services/index.ts'),
    ], file => !file.startsWith(host)).filter(file => file.startsWith(host));
    expect(reached).toContain(host + 'src/features/settings/fe/machine.ts');
    expect(reached).toContain(host + 'src/features/settings/be/store.ts');
    const covered = coveredBy([step]);
    expect(reached.filter(file => !covered.has(file))).toEqual([]);
  });

  it('gives every step the files its script reaches', () => {
    const all = rootScripts();
    const missing = CHAIN_STEPS.flatMap((step) => {
      const covered = coveredBy([step]);
      return [...reachableText(step.name, all).files]
        // A module that only decides *whether* to do the work cannot change what the step accepts, so a step
        // reaching one need not declare it — the same list `package-freshness.spec.ts` reads
        .filter((file) => NOT_A_BUILD_INPUT[file] === undefined)
        .filter((file) => !covered.has(file))
        .map((file) => `${step.name} reaches ${file} and does not declare it`);
    });
    expect(missing).toEqual([]);
  });

  /**
   * Every input exists, bar the two kinds for which absent is the ordinary state.
   *
   * `WORKSPACE_PARTS` is offered to every package and its own comment says eleven of them have none, so a
   * per-input check over the raw list reports 1539 paths. A step's declared `outputs` are absent on a fresh
   * clone until the step that writes them runs. **What is left is a path someone wrote out by hand**, and
   * there the existence question is the whole point: it names no file, so it contributes nothing to the
   * fingerprint and the step caches over a gap.
   *
   * It used to ask whether *every* input was missing, which is a different and much weaker claim — a step
   * with five real inputs and one typo passed. Measured on the day this landed: adding
   * `packages/apack-sdk/tsconfig.NOPE.json` to `api:check` passed 89 cases in this file.
   *
   * The exemption comes from `WORKSPACE_PARTS` itself and never from the *shape* `packages/<pkg>/<part>`,
   * which the bogus path above also has — a shape test exempts exactly what this is for.
   */
  it('gives every step inputs that exist', () => {
    const parts = new Set<string>(WORKSPACE_PARTS);
    const offered = (input: string): boolean => {
      const [, , ...rest] = input.split('/');
      return input.startsWith('packages/') && parts.has(rest.join('/'));
    };
    const written = CHAIN_STEPS.flatMap((step) => step.outputs ?? []);
    const produced = (input: string): boolean => written.some((out) => covers(out, input) || covers(input, out));

    const absent = CHAIN_STEPS.flatMap((step) => step.inputs
      .filter((input) => !fs.existsSync(path.join(REPO_ROOT, input)))
      .filter((input) => !offered(input) && !produced(input))
      .map((input) => `${step.name} declares ${input}, which names nothing`));
    expect(absent, 'a hand-written input that names no file is a step caching over a gap').toEqual([]);
  });
});

/**
 * A step declares the modules its script imports, not only the ones its script names.
 *
 * `gives every step the files its script reaches` above reads a step's npm script as *text*, so it finds
 * every path spelled out in a command and nothing a module reaches from there. That is where `api:check`
 * went wrong on the day this landed: it declared `scripts/api-reports.ts`, which imports
 * `scripts/component-contracts.ts` — the module that writes every `.component.md` — and
 * `scripts/lib/api-entries.ts`, which decides which entries get a report at all. Editing either moved what
 * the step would write while the step reported cached.
 *
 * The same defect, in the same shape, as `chain-table.spec.ts`'s build-unit case: a hand-written list of
 * someone else's inputs is a guess, and the fix is to derive the list and require the hand-written one to
 * cover it. A subset check, so over-declaring stays the harmless direction.
 */
/**
 * A step keys on a staged publish tree only if it reads one.
 *
 * `publish/` is a copy of what a package's `files` names plus a derived manifest (`stagePublishTree`), and
 * nothing resolves *through* it — a published source branch is a resolution failure rather than a fallback,
 * which is the whole reason the tree is staged. So for every step but one it is 610 files that cannot change
 * the answer, and `PACKAGE_BUILD_OUTPUTS` put them in all of them: measured 2026-10-05, 16470 declared
 * file-slots of the chain's 59073, in 26 keys that never opened them. `PACKAGE_BUILD_READS` is what consumers
 * spread now, and this is what notices the next step spreading the other one.
 *
 * **The cost it removed is not only the walk.** An edit to a package's `files` or `exports` map rewrites the
 * derived `publish/package.json`, so the shape of a tarball invalidated 26 steps — including steps that
 * declare nothing else of that workspace and could not care.
 */
describe('a step keys on a staged publish tree only if it reads one', () => {
  /** A step that reads a staged tree, and what reads it. An entry that stops applying is reported. */
  const READS_A_PUBLISHED_TREE: Record<string, string> = {
    'packages:check': 'publint reads each staged tree and attw a tarball packed from one, neither over the '
      + 'dist they are staged from — which is the point of it, since a tarball is what npm ships',
  };

  /** Derived from the files an input covers, so a step naming one file inside a tree is caught like a step naming the tree */
  const declaresAStagedTree = (step: Pick<ChainStep, 'inputs'>): boolean =>
    step.inputs.some((input) => filesUnder(input).some((file) => file.split('/').includes(PUBLISH_TREE)));

  /** One path for the real case and the mutation, so the mutation exercises the rule rather than a copy of it */
  const unexplained = (steps: readonly ChainStep[]): string[] => steps
    .filter((step) => declaresAStagedTree(step))
    .filter((step) => READS_A_PUBLISHED_TREE[step.name] === undefined)
    .map((step) => `${step.name} keys on a staged publish tree and does not read one — spread PACKAGE_BUILD_READS`);

  it('leaves none of them keying on one it never opens', () => {
    expect(unexplained(CHAIN_STEPS)).toEqual([]);
  });

  it('finds the step that does read one, so this is not a check over nothing', () => {
    const found = CHAIN_STEPS.filter((step) => declaresAStagedTree(step)).map((step) => step.name);
    expect(found, 'no step declares a staged tree, so the rule above passes over an empty list')
      .toEqual(Object.keys(READS_A_PUBLISHED_TREE));
  });

  /** The data is a list, so the case mutates it rather than trusting that it could fail */
  it('names a step that starts keying on one', () => {
    const compile = CHAIN_STEPS.find((step) => step.name === 'build:default-setup')!;
    const widened = { ...compile, inputs: [...compile.inputs, `packages/apack-ears/${PUBLISH_TREE}`] };
    expect(unexplained([widened]), 'a step given a staged tree was not reported').toEqual([
      'build:default-setup keys on a staged publish tree and does not read one — spread PACKAGE_BUILD_READS',
    ]);
  });

  /**
   * The rule is about `inputs` and deliberately not about every declaration. `packages:ensure` *writes* the
   * staged trees and names them as `outputs`, which is what makes every other step's edge to it derivable —
   * so widening this check to all declarations would re-flag the one step whose declaration is the reason
   * the rest can be narrowed.
   */
  it('says nothing about the step that writes them', () => {
    const ensure = CHAIN_STEPS.find((step) => step.name === 'packages:ensure')!;
    expect(ensure.outputs?.some((out) => out.endsWith(`/${PUBLISH_TREE}`)),
      'packages:ensure stopped declaring the staged trees it writes, which is what this rule rests on').toBe(true);
    expect(unexplained([ensure]), 'it was reported for writing what it declares as an output').toEqual([]);
  });
});

describe('a step declares the modules its script imports', () => {
  /**
   * The two boundaries, both derived, both the same ones the pool case below already argues for.
   *
   * **The step table.** `scripts/lib/chain-steps.ts` is in nearly every step's closure and declaring it would
   * be wrong — it *defines* the declared sets, so its effect on a key is already the key, where declaring the
   * file re-runs every step for an edit to an unrelated one. So its whole closure is out of the population,
   * which is where `step-timeouts`, `core-budget`, `spec-cost` and `measure` go.
   *
   * **A module that decides whether to do the work**, which is `NOT_A_BUILD_INPUT` read by reference rather
   * than copied. The walk *prunes* there rather than filtering afterwards, so `packages-built.ts` excuses the
   * two modules it imports for the same reason it is excused itself — the difference between three rows and
   * thirty.
   */
  const inScripts = [path.join(REPO_ROOT, 'scripts')];
  const table = new Set(reachableFrom([path.join(REPO_ROOT, 'scripts/lib/chain-steps.ts')], inScripts)
    .map((file) => repoRelative(file)));
  const decidesWhether = (file: string): boolean => NOT_A_BUILD_INPUT[file] !== undefined;
  const excused = (file: string): boolean => table.has(file) || decidesWhether(file);

  /** The `.ts` entries a step's script names, which is where the text-level case above already ends */
  const entriesOf = (step: ChainStep, all: ReturnType<typeof rootScripts>): string[] =>
    [...reachableText(step.name, all).files]
      .filter((file) => /\.m?ts$/.test(file))
      .map((file) => path.join(REPO_ROOT, file));

  const walked = (step: ChainStep, all: ReturnType<typeof rootScripts>): string[] =>
    closureOf(entriesOf(step, all), decidesWhether);

  it('leaves nothing its script imports undeclared', () => {
    const all = rootScripts();
    const missing = CHAIN_STEPS.flatMap((step) => {
      if (entriesOf(step, all).length === 0) return [];
      const covered = coveredBy([step]);
      return walked(step, all)
        .filter((file) => !excused(file) && !covered.has(file))
        .map((file) => `${step.name} imports ${file} and does not declare it`);
    });
    expect(missing,
      'editing one of these moves what the step produces while its fingerprint reads fresh')
      .toEqual([]);
  });

  /** What stops the case above passing by walking nothing */
  it('follows a step script past itself', () => {
    const all = rootScripts();
    const sizes = CHAIN_STEPS.filter((step) => entriesOf(step, all).length > 0)
      .map((step) => ({ name: step.name, size: walked(step, all).length }));
    expect(sizes.length, 'no step names a .ts entry, so this case reads nothing').toBeGreaterThan(5);
    // A step whose only entry is pruned walks to that entry alone, which is the prune working rather than the
    // walk failing — so the claim is that some step resolves past its entry, not that every one does
    expect(sizes.some(({ size }) => size > 1),
      'every closure is its entry alone, which means the walk resolved nothing').toBe(true);
  });
});

// A suite whose own specs name build output must declare that it reads it. This is deliberately a subset
// check and not an equality one: a scan of spec text can prove a suite reads the tree, never that it does
// not. `@app/api`'s specs never name the pack's `dist` — they boot the app runtime and host code resolves
// the path — so an equality check called it independent, it ran beside `build:default-setup` under three lanes, and it
// failed. `SUITE_READS`' doc comment carries the measurement that is the authority, and the command that
// reproduces it. What this catches is the cheap half: a spec that starts naming the tree outright.
/**
 * A step that drives the Playwright fixture reads `@apackdev/testing`'s built bundle — the code that
 * launches Electron, finds the main window and bypasses onboarding. It reaches it by *package name*,
 * never by path, so every other check in this file is blind to the edge: they read a step's text for
 * paths, and there is no path to read.
 *
 * Measured 2026-09-30, before this existed. One change to the fixture's source, one rebuild, three
 * steps that run it: `test:packaged-authoring`, which declares the bundle, reported
 * `changed packages/apack-testing/dist/package/dist/index.js`; `test:smoke` and
 * `test:external-pack:app` both reported `cached`. A gate that skips when the thing it drives has
 * changed is not a gate, and `test:smoke` exists to be the one gate on whether the app starts.
 */
describe('a step that drives the app fixture declares the bundle it drives', () => {
  // How a script reaches the fixture: Playwright directly, the CLI's own `test`, or the CLI held in a
  // variable (`"$APACK" pack test`, which `tests/scripts/test-external-pack-app.sh` uses). The third is not
  // optional — without it this watched two steps and not the one it was written for.
  //
  // The same three shapes `check:tiers` looks for (`APP_MARKERS`), and deliberately **not** the same
  // rule: that one asks whether a step launches an app, so it exempts `--contract`, which starts none.
  // This asks whether a step reads the bundle, and `apack pack test --contract` does — the harness it runs
  // is published from it. Keep the shapes in step; the lookahead is where the two questions differ.
  const DRIVES_THE_APP = /playwright\s+test\b|\bapack["']?\s+pack\s+test\b|\$\{?APACK\}?"?\s+pack\s+test\b/;
  const fixture = BUILD_UNITS['@apackdev/testing'].outputs.map(repoRelative);
  const all = rootScripts();
  // Only the cacheable ones: a step that never caches cannot cache over anything, so the rule has no
  // subject there. `test` is the one that drives the app and declares no bundle, and carries its reason
  // for never caching instead
  const drivers = CHAIN_STEPS
    .filter((step) => step.neverCachedBecause === undefined)
    .filter((step) => DRIVES_THE_APP.test(reachableText(step.name, all).text));

  it('finds the steps that drive it, so this is not a check over nothing', () => {
    expect(drivers.map((step) => step.name).sort()).not.toEqual([]);
  });

  it('leaves none of them caching over it', () => {
    const undeclared = drivers.flatMap((step) => {
      const covered = (output: string) => step.inputs.some((input) => output === input || output.startsWith(`${input}/`));
      return fixture.filter((output) => !covered(output)).map((output) => `${step.name} runs ${output} and does not declare it`);
    });
    expect(undeclared).toEqual([]);
  });
});

/**
 * **Nothing here compiles a pack into the app any more**, so the check that lived here has no subject. It
 * held `build:runtime` to declaring every compiled file of every built-in pack, because the renderer's surface
 * and the api's tsup each traced a generated entry into the pack's `src` and the renderer's Tailwind globbed
 * it for class names — and with none of that declared, one `.vue` edit left `build:runtime` cached over an app
 * that never held the change (measured 2026-10-07).
 *
 * A pack's backend is loaded at run time from its own `dist/runtime/index.cjs` and its frontend is fetched
 * over `pack://`, so the app's build reads a pack's `dist` and never its source. What would reopen the hole
 * is a bundler config here reaching into a pack's `src` again: `build:runtime`'s own declaration comment and
 * `scripts/build-runtime.ts`'s header both say so, and `coverageOf` above still holds every path a step's script
 * names.
 */

describe('a unit suite whose specs name build output declares it', () => {
  // Every spec in the suite except this one. The patterns below are written out here, so scanning this
  // file finds them and reports whichever suite happens to hold it — which, since the move to
  // @app/repo-checks, is a suite that reads neither tree. A pattern's definition is not evidence about
  // anyone.
  const sources = (dir: string): string[] => {
    const root = path.join(REPO_ROOT, 'packages', dir, 'tests');
    if (!fs.existsSync(root)) return [];
    return inputFiles(root)
      .map((file) => path.join(REPO_ROOT, file))
      .filter((file) => file !== import.meta.filename)
      .map((file) => fs.readFileSync(file, 'utf-8'));
  };
  // Naming `@apackdev/testing` means loading its built bundle — except in `@apackdev/testing`'s own suite, where
  // its specs name it because it is what they are about, and import its `src/` rather than the bundle. A
  // detector must not read a package's own name as evidence about it; the same mistake as scanning the file
  // that declares these patterns.
  const readsPackages = (dir: string, texts: string[]): boolean => {
    const pretest = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', dir, 'package.json'), 'utf-8')) as
      { scripts?: Record<string, string> }).scripts?.pretest ?? '';
    if (pretest.includes('ensure-packages-built')) return true;
    return dir !== 'apack-testing' && texts.some((text) => text.includes('@apackdev/testing'));
  };
  // `PACK_DIR` is the variable the pack fixture reads, so it is matched as a whole word: without the
  // boundaries it also matched `APACK_DEV_PACK_DIRS`, which names a pack's *source* and says nothing about
  // anyone reading a built pack. A detector over identifiers has to mean the identifier.
  const readsPack = (texts: string[]): boolean =>
    texts.some((text) => /\bPACK_DIR\b|default-setup['"`, )\]]*,?\s*['"`]dist|default-setup\/dist/.test(text));

  it('matches the ways a suite reaches a built pack, and nothing that merely contains one of their names', () => {
    expect(readsPack(['process.env.PACK_DIR']), 'the fixture variable').toBe(true);
    expect(readsPack(["path.join(REPO, 'default-setup', 'dist')"]), 'the pack\'s dist by segments').toBe(true);
    expect(readsPack(['packages/default-setup/dist/runtime/index.cjs']), 'the pack\'s dist by path').toBe(true);
    expect(readsPack(["process.env.APACK_DEV_PACK_DIRS = 'tests/packs/external-pack'"]),
      'a variable whose name contains PACK_DIR but names a pack\'s source').toBe(false);
    expect(readsPack(['packages/default-setup/src/features/notes/fe/canvas.vue']),
      "the pack's source, which `build:default-setup` owns rather than this").toBe(false);
  });

  it('leaves none of them undeclared', () => {
    const undeclared: string[] = [];
    for (const { dir } of UNIT_SUITES) {
      const texts = sources(dir);
      const declared = SUITE_READS[dir] ?? {};
      if (readsPackages(dir, texts) && declared.packages !== true) undeclared.push(`${dir} reads the built packages`);
      if (readsPack(texts) && declared.pack !== true) undeclared.push(`${dir} reads the built-in pack's dist`);
    }
    expect(undeclared, 'add these to SUITE_READS in scripts/lib/chain-steps.ts').toEqual([]);
  });

  // There is deliberately no check that a declared reader also needs the step that writes what it reads:
  // `POOL_STEPS` derives `needs` from this same table, so the two cannot disagree and such a test could
  // never fail. The declaration is the single point of truth, which is why getting it right is measured.

});


// Every gitignored input has to be accounted for.
//
// Git already knows what is generated, which makes it the one source of truth nobody has to maintain. A
// gitignored file among a step's inputs was written by *something*, and there are only two honest cases:
// a step you depend on declares it as an output, or you declare that you read around it. Anything else is
// one of the two failures this repo has now produced three times — an undeclared dependency, which races
// under lanes, or churn that stops the step ever caching.
//
// This is the preventive half. `willNotCache` in the chain's summary is the empirical half, and catches
// what no declaration can anticipate; this catches what can be known before anything runs.
/**
 * The modules that decide **how** a pool runs are inputs to every project in it.
 *
 * The same question `BUILD_UNITS` is asked at the bottom of this file — a unit declaring the modules its own
 * runner imports — and it had the same answer: `scripts/lib/unit-pool.ts` holds `POOLS`, the argv, the stamp
 * key and the prune rule, and no suite declared it, so any of those could change and invalidate nothing.
 * `chain-table.spec.ts` records this defect being found by hand once before, for four other runner files:
 * *"the file deciding what the pool runs was the one file the pool could not notice changing"*. This is the
 * derivation that stops a third extraction slipping out.
 *
 * **The boundary is `chain-steps.ts`, and that is the whole subtlety.** It is in the closure, and declaring it
 * would be wrong: it *defines* `suiteInputs`, so its effect on a pool's key is the declared set itself, which
 * the key already covers — where declaring the file would re-run all thirteen suites for an edit to an
 * unrelated step. So everything reachable only through it is out of the population, with that reason, and what
 * is left is the pool's own machinery.
 *
 * One direction, as `suite-reads` has it: over-declaration is not a finding, because `scripts/bounded.ts` and
 * `with-source.mjs` are spawned rather than imported and are declared on purpose.
 */
describe('a pool declares the modules that run it', () => {
  const inScripts = [path.join(REPO_ROOT, 'scripts')];
  const closure = (entry: string): Set<string> =>
    new Set(reachableFrom([path.join(REPO_ROOT, entry)], inScripts).map((file) => repoRelative(file)));

  it('leaves nothing its runner imports undeclared, bar the step table it reads its inputs from', () => {
    const table = closure('scripts/lib/chain-steps.ts');
    const machinery = [...closure('scripts/test-unit-pool.ts')].filter((file) => !table.has(file)).sort();
    expect(machinery.length, 'the walk found no pool machinery, so this would pass over nothing')
      .toBeGreaterThan(2);
    // Every suite declares the same runner set, so one is enough to ask — and `suiteInputs` is where it comes
    // from, which is what both cache layers read
    const declared = new Set(suiteInputs(UNIT_SUITES[0]!, 'fast'));
    expect(machinery.filter((file) => !declared.has(file)),
      'a pool runs through these and no project of it would notice them changing').toEqual([]);
  });
});

/**
 * And a suite's half declares the root config that half runs under — neither more nor less.
 *
 * Declaring both root configs for every suite would cost a cache hit in one direction (an edit to the
 * integration config re-running every fast project) and an identity in the other: the two halves of one
 * suite would hash the same declared set. A pack suite's fast half reads neither, because `npm test -w` runs that package's own config.
 */
describe("a suite's half declares the config that runs it", () => {
  const host = UNIT_SUITES.find((suite) => suite.kind === 'host')!;
  const pack = UNIT_SUITES.find((suite) => suite.kind === 'pack')!;
  const FAST = 'vitest.config.ts';
  const INTEGRATION = 'vitest.integration.config.ts';

  it('gives a host suite the root config of the half, and only that one', () => {
    expect(suiteInputs(host, 'fast')).toContain(FAST);
    expect(suiteInputs(host, 'fast'), 'the fast half does not run under the integration config').not.toContain(INTEGRATION);
    expect(suiteInputs(host, 'integration')).toContain(INTEGRATION);
    expect(suiteInputs(host, 'integration'), 'the expensive half passes --config and reads no other').not.toContain(FAST);
  });

  it('gives a pack suite neither, its own config being in its workspace', () => {
    expect(suiteInputs(pack, 'fast').filter((input) => [FAST, INTEGRATION].includes(input))).toEqual([]);
    expect(suiteInputs(pack, 'fast'), 'its own config is what it runs under, through its workspace')
      .toContain(path.join('packages', pack.dir, 'vitest.config.ts'));
  });

  it('declares generated fixture inputs only for the repository integration half', () => {
    const suite = UNIT_SUITES.find(suite => suite.dir === 'repo-checks')!;
    const outputs = CHAIN_STEPS.find(step => step.name === 'test:external-pack:contract')!.outputs!;
    expect(outputs.length).toBeGreaterThan(0);
    for (const output of outputs) {
      expect(suiteInputs(suite, 'integration')).toContain(output);
      expect(suiteInputs(suite, 'fast')).not.toContain(output);
    }
  });
});

describe('a gitignored input belongs to someone', () => {
  const ignoredRoots = execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
    { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString().split('\n').filter(Boolean).map((entry) => entry.replace(/\/$/, ''));
  const isIgnored = (file: string): boolean => ignoredRoots.some((root) => file === root || file.startsWith(`${root}/`));

  const byName = new Map(CHAIN_STEPS.map((step) => [step.name, step]));
  const ancestorsOf = (name: string, seen = new Set<string>()): Set<string> => {
    const step = byName.get(name);
    for (const need of step ? dependsOn(step) : []) {
      if (seen.has(need)) continue;
      seen.add(need);
      ancestorsOf(need, seen);
    }
    return seen;
  };

  it.each(CHAIN_STEPS.map((step) => step.name))('%s', (name) => {
    const step = byName.get(name)!;
    const accountedFor = [
      ...step.outputs ?? [],
      ...step.excludes ?? [],
      ...[...ancestorsOf(name)].flatMap((need) => byName.get(need)?.outputs ?? []),
    ];
    const unaccounted = [...new Set(step.inputs.flatMap((input) => inputFiles(path.join(REPO_ROOT, input))))]
      .filter((file) => isIgnored(file))
      .filter((file) => !accountedFor.some((owned) => covers(owned, file)));

    expect([...new Set(unaccounted.map((file) => file.split('/').slice(0, 5).join('/')))],
      `${name} hashes generated files nobody declares: depend on the step that writes them, or list them in \`excludes\` with why this step reads around them`)
      .toEqual([]);
  });
});






// A step that reads what another step writes has to depend on it.
//
// `orderedSteps` sorts on `needs` alone, so declaring the path in `inputs` says nothing about ordering: the
// two can run in either order, or together in a lane. This existed, caught `test:integration` reading the
// built-in pack's dist while depending only on `packages:ensure`, and was then deleted by accident in
// `e0c22075f` while that section was being rewritten. It is back, and wider.
//
// Wider because the version that was deleted asked only whether an input was *at or under* another step's
// output. The case it could not see is an input that *contains* one — `typecheck` declaring `tests` while
// the E2E suite writes `tests/screenshots` — and that is exactly the defect that then went unnoticed for a
// day, costing 34s of every warm chain. Both directions are the same mistake seen from either end.
//
// `excludes` is honoured: a step that declares it reads around a tree is not reading it.
describe('a step that reads what another writes depends on it', () => {
  const byName = new Map(CHAIN_STEPS.map((step) => [step.name, step]));
  const ancestorsOf = (name: string, seen = new Set<string>()): Set<string> => {
    const step = byName.get(name);
    for (const need of step ? dependsOn(step) : []) {
      if (seen.has(need)) continue;
      seen.add(need);
      ancestorsOf(need, seen);
    }
    return seen;
  };

  it('names the dependency, not just the path', () => {
    const missing: string[] = [];
    for (const step of CHAIN_STEPS) {
      const ancestors = ancestorsOf(step.name);
      for (const producer of CHAIN_STEPS) {
        if (producer.name === step.name || ancestors.has(producer.name)) continue;
        for (const output of producer.outputs ?? []) {
          // Read around it deliberately, which is what `excludes` says
          if ((step.excludes ?? []).some((excluded) => covers(excluded, output))) continue;
          // Either end: the input is under the output, or the input is a tree containing it
          const touching = step.inputs.filter((input) => covers(output, input) || covers(input, output));
          if (touching.length > 0) missing.push(`${step.name} declares ${touching[0]}, which ${producer.name} writes (${output}), and does not need it`);
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});

/**
 * A step's command is part of its key, and the only part that is not a file.
 *
 * `package.json` used to be in all 29 steps' inputs for one reason: a step is `npm run <name>`, its
 * command lives in a manifest, and a fingerprint hashes paths and bytes — so the whole manifest was the
 * only available proxy. Measured over ~587 commits, 37 touched it and all 37 were scripts-only, each one
 * invalidating every step. `BuildUnit.command` replaced that proxy with the thing itself.
 *
 * Which moves the risk rather than removing it: a key that depends on a text walk of shell is wrong
 * silently, where a scan that depends on one is wrong loudly. These two cases are what stand under it.
 */
describe('a step keys on the command it runs', () => {
  it('gives every step a command, and no two steps the same one', () => {
    const all = rootScripts();
    const byText = new Map<string, string[]>();
    for (const step of CHAIN_STEPS) {
      const text = commandText(step.name, all);
      expect(text, `${step.name} resolves to no command, so its key is its inputs alone and a change to `
        + 'its script would not re-run it').not.toBe('');
      byText.set(text, [...(byText.get(text) ?? []), step.name]);
    }
    const shared = [...byText.values()].filter((names) => names.length > 1);
    expect(shared, 'these steps have one command between them, so one cannot be invalidated without the other')
      .toEqual([]);
  });

  /**
   * The mutation check for the whole change, and it needs no edit to `package.json`: `commandText` takes
   * the scripts map as an argument, so a changed script can be handed to it directly.
   *
   * Inputs are empty on both units on purpose — it isolates the command's contribution to the hash, so a
   * pass cannot come from the files moving instead.
   */
  it('moves a step fingerprint when the text of its script changes', () => {
    const all = rootScripts();
    const [step] = CHAIN_STEPS;
    const before = commandText(step!.name, all);
    const after = commandText(step!.name, { ...all, [step!.name]: `${all[step!.name]!} --changed` });
    expect(after, 'the edited script is not in what this command reaches').not.toBe(before);

    const keyed = (command: string): string => fingerprintUnit({ inputs: [], outputs: [], command });
    expect(keyed(after), 'the command is not in the fingerprint').not.toBe(keyed(before));
  });

  /**
   * The manifest stays out of keys except steps that read it or cover metadata readers.
   *
   * `typecheck:api` is the exception and it is evidenced rather than assumed: its three programs each
   * resolve through the root `package.json`, which its dep files report, so it declares it through
   * `alsoReads`. The dep-file gate found this the moment the manifest left `ROOT` — while every step
   * declared it, a real read and an accident were indistinguishable.
   *
   * Shared build metadata imports the version for script/repo programs (confirmed by their dep files)
   * and the renderer config checked by typecheck:renderer;
   * source-wide checks and suites cover those readers through EVERY_SOURCE.
   *
   * `packages:ensure` declares it too, through `SHARED_INPUTS` in `BUILD_UNITS`, and is filtered out
   * rather than listed: it is never cached, so it has no key to invalidate.
   */
  it('keys package.json only for steps that read it or cover shared build metadata', () => {
    const cached = CHAIN_STEPS.filter((step) => step.neverCachedBecause === undefined);
    expect(cached.length, 'no step is cached, so this passes over nothing').toBeGreaterThan(20);
    expect(cached.filter((step) => step.inputs.includes('package.json')).map((step) => step.name),
      'a step keying on the whole manifest re-runs when any unrelated script is edited; add one here only '
      + 'with the dep-file evidence that it reads the manifest').toEqual([
        'typecheck:renderer', 'typecheck:api', 'check:specifiers', 'typecheck:scripts', 'check:tiers',
        'lint:check', 'test:unit:host', 'test:integration', 'build:runtime',
      ]);
  });
});


describe('app checks observe separately loaded shipped-pack bytes', () => {
  it.each(['test:external-pack:app', 'test:smoke', 'test:e2e', 'test:packaged-authoring:app'])(
    '%s invalidates when a shipped frontend changes without an app-bundle change', name => {
      const step = CHAIN_STEPS.find(step => step.name === name)!;
      const file = 'packages/default-setup/dist/runtime/fe.js';
      let bytes = 'old frontend';
      const tree: TreeReader = {
        listInputs: target => covers(repoRelative(path.resolve(REPO_ROOT, target)), file) ? [file] : [],
        listOutputs: () => [],
        read: () => Buffer.from(bytes),
        digest: () => createHash('sha256').update(bytes).digest('hex'),
      };
      const unit = { ...step, outputs: step.outputs ?? [] };
      const before = fingerprintUnit(unit, undefined, tree);
      bytes = 'frontend with corrected node-view cleanup';
      expect(fingerprintUnit(unit, undefined, tree)).not.toBe(before);
    },
  );
});
