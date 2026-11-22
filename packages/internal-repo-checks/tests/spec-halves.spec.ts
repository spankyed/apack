// The half a spec runs in, and the two walks that find the specs to begin with.
//
// **Written against a planted tree rather than this repo, because the thing most worth checking cannot be
// seen from here.** `specFiles` walks a package whole, `src/` included, and that reach is a net for a
// spec no config would collect — every include is `tests/**`. No package colocates one today, so the
// reach has no live subject, and narrowing the walk to `tests/` left the entire suite green: the case
// that looked like its protection (`spec-placement.spec.ts`' "reports a spec colocated in src/") hands
// `uncollected` a path *string*, so it proves the rule classifies such a path and says nothing about
// whether anything would ever find the file. A fixture is the only way to ask the walk itself.
//
// `specFilesUnder` (`test-timeouts.ts`) is the second walk and had no spec either. Its case here records
// what it does rather than what one might want it to do — see the describe.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_BY_HALF, HALVES, IGNORED, configsFor, halfOfPath, hasSplit, specFiles } from '../../../scripts/lib/spec-halves.ts';
import { specFilesUnder } from '../../../scripts/lib/test-timeouts.ts';

const temp: string[] = [];
const tmpdir = (): string => {
  const made = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-halves-'));
  temp.push(made);
  return made;
};
afterEach(() => {
  for (const dir of temp.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Writes a file and the directories above it, so a case names a path and not a sequence of mkdirs */
const plant = (root: string, file: string, body = 'export {};\n'): void => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), body);
};

describe('specFiles', () => {
  /**
   * The reach this exists for, and the one no case could reach from the real tree.
   *
   * A spec under `src/` is collected by no config — every include is `tests/**` — so if the walk did not
   * see it, nothing would report it missing either: it would have no measured cost and no line saying so,
   * silent twice over. `@app/default-setup` really ran six that way before they moved.
   */
  it('finds a spec under src/, not only one under tests/', () => {
    const root = tmpdir();
    plant(root, 'src/colocated.spec.ts');
    plant(root, 'tests/proper.spec.ts');
    expect(specFiles(root)).toEqual(['src/colocated.spec.ts', 'tests/proper.spec.ts']);
  });

  // The population the cases below are generated from, asserted non-empty: `it.each` over an empty set
  // produces no cases at all and reports a green file, so emptying `IGNORED` would delete its own coverage
  it('has directories to ignore, so the cases below are not generated from nothing', () => {
    expect(IGNORED.size).toBeGreaterThan(0);
  });

  // Over the declaration rather than a list of names, so a member added to `IGNORED` without a case is
  // not possible. Each gets a spec inside it that the walk must not return.
  it.each([...IGNORED])('skips what a package builds or vendors: %s', (ignored) => {
    const root = tmpdir();
    plant(root, `${ignored}/buried.spec.ts`);
    plant(root, 'tests/proper.spec.ts');
    expect(specFiles(root)).toEqual(['tests/proper.spec.ts']);
  });

  it('skips a dot directory, which is where tooling keeps its own copies', () => {
    const root = tmpdir();
    plant(root, '.cache/buried.spec.ts');
    plant(root, 'tests/proper.spec.ts');
    expect(specFiles(root)).toEqual(['tests/proper.spec.ts']);
  });

  // `.test.ts` as well as `.spec.ts`: `@app/default-setup` names some of its own that way, and a walk
  // that missed them would drop them from the ranking, the cache and `spec:dry`'s plan at once
  it('matches .test.ts beside .spec.ts, and nothing else', () => {
    const root = tmpdir();
    plant(root, 'tests/a.spec.ts');
    plant(root, 'tests/b.test.ts');
    plant(root, 'tests/helper.ts');
    plant(root, 'tests/c.spec.tsx');
    expect(specFiles(root)).toEqual(['tests/a.spec.ts', 'tests/b.test.ts']);
  });

  /**
   * Relative to the package and sorted, which is what every consumer depends on.
   *
   * Relative because a duration record, a config glob and a git path all name a spec that way, so an
   * absolute path would key the cache under something no other reader could look up. Sorted because the
   * order is otherwise the filesystem's, and two runs of the same tree would disagree.
   */
  it('returns paths relative to the package, in a stable order', () => {
    const root = tmpdir();
    for (const file of ['tests/z.spec.ts', 'tests/a.spec.ts', 'tests/m/nested.spec.ts']) plant(root, file);
    const found = specFiles(root);
    expect(found).toEqual(['tests/a.spec.ts', 'tests/m/nested.spec.ts', 'tests/z.spec.ts']);
    for (const file of found) expect(path.isAbsolute(file), file).toBe(false);
  });

  it('finds none in a package with no specs, rather than refusing', () => {
    expect(specFiles(tmpdir())).toEqual([]);
  });
});

describe('specFilesUnder', () => {
  /**
   * What it does, which is not what `specFiles` does — and the difference is a constraint on its callers.
   *
   * It carries no ignore set at all, so pointed at a package root it would walk `node_modules` and return
   * every dependency's specs. It is safe because both callers hand it `packages/<dir>/tests`
   * (`suite-timeouts.spec.ts`, `spec-waits.spec.ts`). This case asserts the behaviour it has rather than
   * the behaviour one might prefer: a case claiming it skips `node_modules` would be a change request
   * wearing a test's clothes, and the honest way to make that true is to give it the set and say so.
   */
  it('descends into node_modules, so its callers must pass a tests/ directory', () => {
    const root = tmpdir();
    plant(root, 'node_modules/dep/tests/theirs.spec.ts');
    plant(root, 'tests/ours.spec.ts');
    expect(specFilesUnder(root)).toHaveLength(2);
    expect(specFilesUnder(path.join(root, 'tests')), 'which is what both callers give it')
      .toEqual([path.join(root, 'tests', 'ours.spec.ts')]);
  });

  // Where `specFiles` throws. Its callers walk a directory that need not exist — a package with no
  // `tests/` is a package with no specs, not an error
  it('answers an absent directory with none', () => {
    expect(specFilesUnder(path.join(tmpdir(), 'tests'))).toEqual([]);
  });
});

describe('the half a path runs in', () => {
  it('reads the suffix, which is the whole rule', () => {
    expect(halfOfPath('packages/apack-cli/tests/a.integration.spec.ts')).toBe('integration');
    expect(halfOfPath('packages/apack-cli/tests/a.spec.ts')).toBe('fast');
  });

  // Every half has a config, or a pool would ask for one that does not exist
  it('has a config for each half it declares', () => {
    expect(HALVES.length, 'no halves were derived, so this proves nothing').toBeGreaterThan(1);
    for (const half of HALVES) expect(CONFIG_BY_HALF[half], half).toMatch(/^vitest\..*config\.ts$/);
  });
});

/**
 * Whether a package has a second half, which is what says a spec can move between them at all.
 *
 * Read by `INTEGRATION_SUITES` and by the line `poolDurationLines` prints counting the `@slow:` markers
 * whose package has nowhere to send a spec — so a wrong answer here would make that count a fiction.
 */
describe('hasSplit', () => {
  it('is false for a package with one config, which has nowhere to move a spec to', () => {
    const root = tmpdir();
    fs.writeFileSync(path.join(root, CONFIG_BY_HALF.fast), '');
    expect(configsFor(root)).toEqual([CONFIG_BY_HALF.fast]);
    expect(hasSplit(root)).toBe(false);
  });

  it('is true once both configs are there', () => {
    const root = tmpdir();
    for (const config of Object.values(CONFIG_BY_HALF)) fs.writeFileSync(path.join(root, config), '');
    expect(configsFor(root)).toHaveLength(Object.keys(CONFIG_BY_HALF).length);
    expect(hasSplit(root)).toBe(true);
  });

  it('is false for a package with no configs at all', () => {
    expect(hasSplit(tmpdir())).toBe(false);
  });
});
