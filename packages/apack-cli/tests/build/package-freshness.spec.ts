import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INTERRUPTS } from '@apackdev/host/exclusive-lock';
import { ABSENT, ALLOW_UNBUILT, BUILD_UNITS, packageBuildState, buildScriptFor, changedInputs, CHECKOUT_MARKER, covers, declaredPaths, diffableStamp, ensurePackagesBuilt, fingerprintInputs, fingerprintUnit, fingerprintWithDigests, freshnessSweep, inputFiles, outputDigests, INPUTS_CHANGED, PACKAGES_PREBUILT_ENV, packageWriter, PackagesWentStale, repoRelative, NOT_A_BUILD_INPUT, REPO_ROOT, staleMessage, stampRecord, stampedBuild, stampedRun, stampedRunAll, stampFile, unbuiltRefusal, unitStaleReason, withBuildLock, type BuildIntent, type BuildUnit, type StaleUnit } from '@apackdev/host/build/packages-built';

/**
 * The freshness rule behind `npm test -w @apackdev/cli`'s pretest (@apackdev/host/build/packages-built):
 * a success stamp holding a content fingerprint of the build's inputs, so output that no successful
 * build produced never reads as built. Everything here runs on temporary fixtures — a spec must
 * never build the repo's packages (that is the pretest's job, in its own process).
 */

const temps: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-freshness-'));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A watched source tree plus its output tree, as a build unit sees them */
/** A temp package to build: its sources, its output tree, and the unit that ties them together */
interface Fixture {
  readonly root: string;
  readonly src: string;
  readonly out: string;
  readonly unit: BuildUnit;
}

function fixture(): Fixture {
  const root = tempDir();
  const src = path.join(root, 'src');
  const out = path.join(root, 'dist');
  fs.mkdirSync(path.join(src, 'nested'), { recursive: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(src, 'nested', 'b.ts'), 'export const b = 2;\n');
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
  fs.writeFileSync(path.join(out, 'a.js'), 'export const a = 1;\n');
  return { root, src, out, unit: { inputs: [src, path.join(root, 'package.json')], outputs: [out] } };
}

/** What a successful build of the fixture writes */
function stampFor(f: Fixture): string {
  const stamp = path.join(f.root, 'stamp.json');
  fs.writeFileSync(stamp, JSON.stringify({ ...fingerprintWithDigests(f.unit), declared: declaredPaths(f.unit), outputFiles: outputDigests(f.unit) }));
  return stamp;
}

describe('what a walk of a declared input leaves out', () => {
  /**
   * A bundler's compiled config. `bundle-require` (through `tsup`) writes `<name>.bundled_<id>.mjs` beside the
   * config it is loading and removes it when the build ends, so for the length of a build one sits in
   * `packages/api` — a directory several steps declare.
   *
   * A fingerprint taken while one exists records a file the next walk cannot find, so the step is stale
   * forever after and the reason never surfaces. Its id is random, which is why no `excludes` entry can name
   * it and the walk has to.
   */
  it('leaves out a config a bundler compiled to load it, and nothing else ending in .mjs', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'tsup.config.ts'), '');
    fs.writeFileSync(path.join(dir, 'tsup.config.bundled_vu940slpzx.mjs'), '');
    fs.writeFileSync(path.join(dir, 'vite.config.bundled_abc123.cjs'), '');
    fs.writeFileSync(path.join(dir, 'electron-builder.mjs'), '');

    const found = inputFiles(dir).map((file) => path.basename(file)).sort();

    expect(found).toEqual(['electron-builder.mjs', 'tsup.config.ts']);
  });
});

describe('the watched input set', () => {
  it('is exactly the workspaces npm run packages:build builds', () => {
    const script: string = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')).scripts['packages:build'];
    const workspaces = [...script.matchAll(/-w\s+(\S+)/g)].map(([, name]) => name);
    expect(workspaces.length).toBeGreaterThan(0);
    expect(Object.keys(BUILD_UNITS).sort()).toEqual(workspaces.sort());
  });

  it('covers every source the CLI and testing bundles inline, not just the published packages', () => {
    // scripts/bundle-package.ts inlines @apackdev/host into both bundles, and the published-* specs
    // read @apackdev/testing's bundle: editing either left the bundles stale and the suite green.
    // Checked per unit, not over the union: one bundle watching @apackdev/host does not cover the other.
    for (const workspace of ['@apackdev/testing', '@apackdev/cli']) {
      const inputs = new Set(BUILD_UNITS[workspace].inputs);
      for (const input of ['packages/apack-host/src', 'packages/apack-host/package.json', 'scripts/bundle-package.ts']) {
        expect(inputs, workspace).toContain(path.join(REPO_ROOT, input));
      }
    }
    expect(new Set(BUILD_UNITS['@apackdev/testing'].inputs)).toContain(path.join(REPO_ROOT, 'packages', 'apack-testing', 'src'));
    expect(new Set(BUILD_UNITS['@apackdev/cli'].inputs)).toContain(path.join(REPO_ROOT, 'packages', 'apack-cli', 'src'));
  });

  it('covers each package build script and the configs it reads', () => {
    for (const [pkg, unit] of [['apack-ears', '@apackdev/ears'], ['apack-sdk', '@apackdev/sdk'], ['apack-ui', '@apackdev/ui']] as const) {
      const inputs = new Set(BUILD_UNITS[unit].inputs);
      for (const input of ['src', 'package.json', 'tsconfig.json', 'tsconfig.package.json']) {
        expect(inputs, `${unit}: ${input}`).toContain(path.join(REPO_ROOT, 'packages', pkg, input));
      }
      // The build script is the repo's, not the package's: a package's own scripts are its other tooling
      expect(inputs, `${unit}: the build script`).toContain(path.join(REPO_ROOT, 'scripts', 'build-package.ts'));
    }
    const ui = new Set(BUILD_UNITS['@apackdev/ui'].inputs);
    expect(ui).toContain(path.join(REPO_ROOT, 'packages', 'apack-ui', 'tsdown.config.ts'));
    expect(ui).toContain(path.join(REPO_ROOT, 'scripts', 'build-ui-package.ts'));
    // @apackdev/ui's build reads its exports helper, which stays with the package for exports:update
    expect(ui).toContain(path.join(REPO_ROOT, 'packages', 'apack-ui', 'scripts', 'exports.ts'));
  });

  // "No marker" and "not a checkout" are the same observation, and the second is legitimate for every
  // installed pack — so a marker that stops resolving turns the freshness guard off with nothing to see
  it('marks this checkout with a file that is here, so moving the marker fails a test and not a run', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, CHECKOUT_MARKER)), CHECKOUT_MARKER).toBe(true);
  });

  it('names only paths that exist, so a renamed input cannot drop out unnoticed', () => {
    const missing = Object.values(BUILD_UNITS).flatMap((unit) => [...unit.inputs]).filter((input) => !fs.existsSync(input));
    expect(missing).toEqual([]);
  });

  it('gives each workspace its own stamp, outside every output tree', () => {
    const stamps = Object.keys(BUILD_UNITS).map(stampFile);
    expect(new Set(stamps).size).toBe(stamps.length);
    for (const [workspace, unit] of Object.entries(BUILD_UNITS)) {
      for (const output of unit.outputs) expect(stampFile(workspace).startsWith(output)).toBe(false);
    }
  });
});

/**
 * `buildScriptFor` reads a workspace's own `build:package` to answer how it is built — which is what the
 * exemption above turns on, and what nothing tested.
 *
 * Against a fixture rather than the repo, because the repo cannot be used: `build:package` lives in a
 * `package.json` that is one of the unit's declared inputs, so editing it to see the answer change makes the
 * unit stale, and this file then refused to run. That is why it takes a `root`.
 */
describe('buildScriptFor', () => {
  /** A tree with one workspace in it, as `buildScriptFor` walks one */
  const treeWith = (manifest: Record<string, unknown>): string => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'packages', 'thing'), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages', 'thing', 'package.json'), JSON.stringify(manifest));
    return root;
  };

  // The two answers the exemption reads, and the only difference between them is the manifest
  it.each([
    ['bundles, so it inlines host', 'tsx ../../scripts/bundle-package.ts .', 'scripts/bundle-package.ts'],
    ['compiles, so it does not', 'tsx ../../scripts/build-package.ts .', 'scripts/build-package.ts'],
  ])('reads a workspace that %s', (_what, script, expected) => {
    const root = treeWith({ name: '@x/thing', scripts: { 'build:package': script } });
    expect(buildScriptFor('@x/thing', root)).toBe(expected);
  });

  it('refuses a workspace whose build:package names no script under scripts/', () => {
    const root = treeWith({ name: '@x/thing', scripts: { 'build:package': 'tsdown' } });
    expect(() => buildScriptFor('@x/thing', root)).toThrow(/@x\/thing's build:package names no script/);
  });

  it('refuses a name no manifest declares', () => {
    const root = treeWith({ name: '@x/thing', scripts: { 'build:package': 'tsx ../../scripts/build-package.ts .' } });
    expect(() => buildScriptFor('@x/other', root)).toThrow(/no packages\/\* declares the name @x\/other/);
  });
});

describe('refusing an unbuilt tree', () => {
  /**
   * Gated on `CI` this never fired, because this repo's CI is off by design — and thirteen spec files sit
   * behind the `false` it used to return, nine of them all of `@app/publish-checks`. Put `process.env.CI`
   * back in place of the escape and the first case below passes on an unbuilt tree, which is the bug.
   */
  it('refuses, naming the build command and the way to run anyway', () => {
    const refusal = unbuiltRefusal(false, 'npm run packages:build', {});

    expect(refusal).toContain('npm run packages:build');
    expect(refusal).toContain(ALLOW_UNBUILT);
  });

  it('lets a caller through when the escape is set, since it asked for a run that checks nothing', () => {
    expect(unbuiltRefusal(false, 'npm run packages:build', { [ALLOW_UNBUILT]: '1' })).toBeNull();
  });

  it('says nothing when the packages are built', () => {
    expect(unbuiltRefusal(true, 'npm run packages:build', {})).toBeNull();
  });
});

describe('the stamp protocol', () => {
  it('reads a stamp whose fingerprint is not a string as never built', () => {
    const f = fixture();
    const stamp = path.join(f.root, 'stamp.json');
    fs.writeFileSync(stamp, JSON.stringify({ fingerprint: 42 }));
    expect(unitStaleReason(f.unit, stamp)).toMatch(/no stamp/);
  });

  it('requires current input/output evidence before accepting a successful fingerprint', () => {
    const f = fixture();
    const stamp = path.join(f.root, 'stamp.json');
    fs.writeFileSync(stamp, JSON.stringify({ fingerprint: fingerprintUnit(f.unit) }));
    expect(unitStaleReason(f.unit, stamp)).toMatch(/no stamp/);
  });

  // Hashing only the contents would read a widened input set against the old stamp and call it fresh
  it('is stale when a unit gains a watched path, before anything under it changes', () => {
    const f = fixture();
    const stamp = stampFor(f);
    expect(unitStaleReason(f.unit, stamp)).toBeNull();
    const widened = { inputs: [...f.unit.inputs, path.join(f.root, 'tsdown.config.ts')], outputs: f.unit.outputs };
    expect(unitStaleReason(widened, stamp)).toMatch(/inputs changed/);
  });

  it('is stale when a unit gains an output, which changes what counts as built', () => {
    const f = fixture();
    const stamp = stampFor(f);
    const widened = { inputs: f.unit.inputs, outputs: [...f.unit.outputs, path.join(f.root, 'dist2')] };
    // The missing output is reported first; the point is that the stamp no longer matches either
    expect(unitStaleReason(widened, stamp)).not.toBeNull();
    fs.mkdirSync(path.join(f.root, 'dist2'), { recursive: true });
    expect(unitStaleReason(widened, stamp)).toMatch(/inputs changed/);
  });

  // These modules decide whether to build; none can change what a build emits. The list is
  // `NOT_A_BUILD_INPUT`, shared with `chain-inputs.spec.ts`' closure guard, which would otherwise demand
  // exactly what this refuses — two lists here would be two answers to one question.
  //
  // Asked over **resolved** files rather than the declared strings, because an input may be a directory. This
  // compared declarations until 2026-09-27, and a declaration of the whole `apack-host/src/build` then
  // satisfied it while violating it: the directory contains `packages-built.ts` without equalling it, so the
  // refusal and the guard demanding the same file coexisted for two commits. `inputFiles` carries the rule.
  it('does not watch the code that decides freshness', () => {
    expect(Object.keys(NOT_A_BUILD_INPUT).length, 'an empty list makes this case vacuous').toBeGreaterThan(0);
    // A bundle that inlines @apackdev/host emits that source, so watching it is right — derived from the
    // workspace's own `build:package` rather than naming the two units, which is a fact about how they build.
    // What `buildScriptFor` makes of a manifest is covered by `describe('buildScriptFor')` below, against a
    // fixture: editing a real `build:package` to test it makes that unit stale, and a stale unit used to stop
    // this file running at all.
    const inlinesHost = (workspace: string) => buildScriptFor(workspace) === 'scripts/bundle-package.ts';
    const offences = Object.keys(BUILD_UNITS).flatMap((workspace) => {
      if (inlinesHost(workspace)) return [];
      const resolved = new Set(BUILD_UNITS[workspace].inputs.flatMap((input) => inputFiles(input)));
      return Object.keys(NOT_A_BUILD_INPUT)
        .filter((rule) => resolved.has(rule))
        .map((rule) => `${workspace} watches ${rule} — ${NOT_A_BUILD_INPUT[rule]}`);
    });
    expect(offences).toEqual([]);

    // The other direction, for the units that are exempt: they watch all of apack-host/src *because* they
    // inline it, so the exemption above is not a hole they could fall through by declaring nothing
    const bundles = Object.keys(BUILD_UNITS).filter(inlinesHost);
    expect(bundles.length, 'no unit inlines host, so the exemption above is vacuous').toBeGreaterThan(0);
    for (const workspace of bundles) {
      expect(new Set(BUILD_UNITS[workspace].inputs), workspace).toContain(path.join(REPO_ROOT, 'packages', 'apack-host', 'src'));
    }
  });
});

describe('covers', () => {
  /**
   * The one thing this must not get wrong, and the reason the separator is in the comparison. Three questions
   * about declared paths used to each write it out — is this file excluded, whose output is it, does one step's
   * input tree hold another's — and a prefix match without the separator answers all three wrongly for a
   * sibling whose name starts with the same letters.
   */
  it('covers a path under it, and not a sibling whose name merely starts the same', () => {
    expect(covers('src/build', 'src/build/packages-built.ts')).toBe(true);
    expect(covers('src/build', 'src/build')).toBe(true);
    expect(covers('src/build', 'src/buildings/index.ts')).toBe(false);
    expect(covers('src/build/packages-built.ts', 'src/build')).toBe(false);
  });
});

/**
 * The other half of `covers`: both sides of every comparison it makes have to be spelled the same way.
 *
 * One side is always a hand-written POSIX literal — `chain-steps.ts` declares `'packages/default-setup/dist'` —
 * and the other came from `path.relative`, which is backslash-separated on Windows, where nothing matched and a
 * unit hashed its own declared outputs into its own fingerprint. Neither case below can fail on this platform,
 * because here `path.sep` is already `/`; what they hold is the thing that makes the other platform correct.
 */
describe('repoRelative', () => {
  it('is what path.relative already gives on a platform whose separator is a slash', () => {
    const f = fixture();
    expect(path.sep, 'this platform separates with something else, so the case below means more than it says').toBe('/');
    expect(repoRelative(path.join(f.src, 'a.ts'))).toBe(path.relative(REPO_ROOT, path.join(f.src, 'a.ts')));
  });

  /**
   * And it stays the only boundary. A bare `path.relative(REPO_ROOT, …)` returning to any of these is how one side
   * of a `covers` comparison drifts back out of spelling with the other, which nothing on this platform would
   * notice — so the check is on the source rather than on a result.
   */
  it('is the only way these modules make a repo-relative path', () => {
    const onTheCachePath = ['packages/apack-host/src/build/packages-built.ts', 'scripts/lib/chain-steps.ts',
      'scripts/lib/chain-output.ts', 'scripts/chain.ts'];
    const offenders = onTheCachePath.flatMap((file) => {
      const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
      return source.split('\n')
        .map((line, index) => ({ at: `${file}:${index + 1}`, line }))
        // The definition itself is the one place it may appear
        .filter(({ line }) => line.includes('path.relative(REPO_ROOT') && !line.includes('export const repoRelative'))
        .map(({ at }) => at);
    });
    expect(offenders, 'use repoRelative, or a covers comparison has one POSIX side and one platform side').toEqual([]);
  });
});

describe('the input fingerprint', () => {
  // A unit's own output is never its own input, however broadly its inputs are declared. Two chain steps
  // declare a whole tree and then write into it — `build:default-setup` writes `src/__generated__` under the `src` it
  // reads, the fixture-pack check writes each pack's `dist` under the `tests/packs` it reads — and both
  // were self-invalidating in waiting: the only thing keeping them cached was those builds happening to be
  // byte-identical, and the pack build already is not (union ordering in its emitted declarations).
  it('ignores a change under the unit\'s own output, and still sees one under its inputs', () => {
    const f = fixture();
    // The output tree sits inside the input tree, which is the shape that caused this
    const nested = path.join(f.src, 'generated');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'emitted.ts'), 'export const emitted = 1;\n');
    const unit = { inputs: f.unit.inputs, outputs: [...f.unit.outputs, nested] };

    const before = fingerprintUnit(unit);
    fs.writeFileSync(path.join(nested, 'emitted.ts'), 'export const emitted = 2;\n');
    expect(fingerprintUnit(unit), 'its own output moved the fingerprint').toBe(before);

    fs.writeFileSync(path.join(f.src, 'a.ts'), 'export const a = 99;\n');
    expect(fingerprintUnit(unit), 'a real input stopped being seen').not.toBe(before);
  });

  it('changes when a watched file changes', () => {
    const f = fixture();
    const before = fingerprintInputs(f.unit.inputs);
    fs.writeFileSync(path.join(f.src, 'a.ts'), 'export const a = 2;\n');
    expect(fingerprintInputs(f.unit.inputs)).not.toBe(before);
  });

  it('changes when a watched file is deleted — which an output-is-newer check never sees', () => {
    const f = fixture();
    const before = fingerprintInputs(f.unit.inputs);
    fs.rmSync(path.join(f.src, 'nested', 'b.ts'));
    expect(fingerprintInputs(f.unit.inputs)).not.toBe(before);
  });

  it('changes when a watched file is added', () => {
    const f = fixture();
    const before = fingerprintInputs(f.unit.inputs);
    fs.writeFileSync(path.join(f.src, 'c.ts'), 'export const c = 3;\n');
    expect(fingerprintInputs(f.unit.inputs)).not.toBe(before);
  });

  it('distinguishes which file holds which content', () => {
    const f = fixture();
    const a = path.join(f.src, 'a.ts');
    const b = path.join(f.src, 'nested', 'b.ts');
    const [aText, bText] = [fs.readFileSync(a, 'utf-8'), fs.readFileSync(b, 'utf-8')];
    const before = fingerprintInputs(f.unit.inputs);
    fs.writeFileSync(a, bText);
    fs.writeFileSync(b, aText);
    expect(fingerprintInputs(f.unit.inputs)).not.toBe(before);
  });

  it('ignores mtimes, which move without an edit and tie on coarse filesystems', () => {
    const f = fixture();
    const before = fingerprintInputs(f.unit.inputs);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    fs.utimesSync(path.join(f.src, 'a.ts'), future, future);
    expect(fingerprintInputs(f.unit.inputs)).toBe(before);
  });

  /**
   * `excludeSuffixes` is `excludes` by extension, and these are its firing cases.
   *
   * The declared tree holds two kinds of file and the unit reads one of them — `api:check` over a package's
   * `dist`, where a report is a function of the declarations and never of the compiled output beside them.
   * The three cases are the three ways that claim can be wrong: the excluded kind still counting, the kept
   * kind quietly not counting, and the rule itself sitting outside the key so that narrowing it leaves a
   * stamp taken under the old rule answering for the new one.
   */
  describe('excludeSuffixes', () => {
    /** A tree of both kinds, declared whole, with only the declarations read */
    const bothKinds = (): { inputs: string[]; dts: string; js: string; unit: BuildUnit } => {
      const root = tempDir();
      fs.mkdirSync(root, { recursive: true });
      const dts = path.join(root, 'a.d.ts');
      const js = path.join(root, 'a.js');
      fs.writeFileSync(dts, 'export declare const a: number;\n');
      fs.writeFileSync(js, 'export const a = 1;\n');
      return { inputs: [root], dts, js, unit: { inputs: [root], outputs: [], excludeSuffixes: ['.js'] } };
    };

    it('leaves the fingerprint where only an excluded suffix moved', () => {
      const t = bothKinds();
      const before = fingerprintUnit(t.unit);
      fs.writeFileSync(t.js, 'export const a = 2;\n');
      expect(fingerprintUnit(t.unit), 'the compiled output moved the key it is excluded from').toBe(before);
    });

    it('still moves it where a file it reads moved', () => {
      const t = bothKinds();
      const before = fingerprintUnit(t.unit);
      fs.writeFileSync(t.dts, 'export declare const a: string;\n');
      expect(fingerprintUnit(t.unit), 'a declaration moved and the key did not').not.toBe(before);
    });

    /**
     * Narrowing a unit's rule makes it stale, which is what the step that introduced this needed: every
     * stamp taken under the wider rule has to stop answering. It holds *through the file set* rather than by
     * hashing the rule — a file it used to hash stops being hashed — which is also why the rule is not in
     * the key itself. Hashing it as well was written first, and deleting that line left all of these green.
     */
    it('makes a unit stale when the rule narrows, through the set it hashes', () => {
      const t = bothKinds();
      const wide = fingerprintUnit({ ...t.unit, excludeSuffixes: undefined });
      expect(fingerprintUnit(t.unit), 'the same tree under two rules hashed the same').not.toBe(wide);
    });

    /** And the other half of that: a rule the tree gives nothing to exclude costs no invalidation */
    it('does not move a unit for a suffix nothing under its inputs has', () => {
      const t = bothKinds();
      const before = fingerprintUnit(t.unit);
      expect(fingerprintUnit({ ...t.unit, excludeSuffixes: [...t.unit.excludeSuffixes!, '.graphql'] }),
        'excluding a suffix the tree has none of re-keyed the unit').toBe(before);
    });
  });

  it('ignores a missing input consistently', () => {
    const f = fixture();
    const absent = path.join(f.root, 'tsdown.config.ts');
    const inputs = [...f.unit.inputs, absent];
    const before = fingerprintInputs(inputs);
    expect(fingerprintInputs(inputs)).toBe(before);
    fs.writeFileSync(absent, 'export default {};\n');
    expect(fingerprintInputs(inputs)).not.toBe(before);
  });

  it('does not throw when a watched file disappears mid-walk', () => {
    // The pretest reported this ENOENT as "npm run packages:build failed" though the build never ran
    const f = fixture();
    const gone = path.join(f.src, 'gone.ts');
    fs.writeFileSync(gone, 'export const gone = true;\n');
    const files = [...f.unit.inputs];
    fs.rmSync(gone);
    expect(() => fingerprintInputs([...files, gone])).not.toThrow();
  });
});

describe('the staleness verdict', () => {
  it('is fresh when the stamp matches the inputs', () => {
    const f = fixture();
    expect(unitStaleReason(f.unit, stampFor(f))).toBeNull();
  });

  it('is stale without a stamp, even when the output tree looks complete', () => {
    // A failed build leaves exactly this, and the complete tree is no longer a lie about it: the build stages
    // its work and renames it into place, so what a reader finds is the *previous* build whole, with its
    // stamp dropped on the throw. Unstamped is the only thing left saying don't trust it
    const f = fixture();
    expect(unitStaleReason(f.unit, path.join(f.root, 'stamp.json'))).toMatch(/no stamp/);
  });

  it('is stale when the stamp is unreadable or has no fingerprint', () => {
    const f = fixture();
    const stamp = path.join(f.root, 'stamp.json');
    fs.writeFileSync(stamp, '{ not json');
    expect(unitStaleReason(f.unit, stamp)).toMatch(/no stamp/);
    fs.writeFileSync(stamp, '{}');
    expect(unitStaleReason(f.unit, stamp)).toMatch(/no stamp/);
  });

  it('is stale when a source changed, whatever the output mtimes say', () => {
    const f = fixture();
    const stamp = stampFor(f);
    fs.writeFileSync(path.join(f.src, 'a.ts'), 'export const a = 2;\n');
    // The output is untouched and newer than nothing — only the fingerprint can tell
    expect(unitStaleReason(f.unit, stamp)).toMatch(/inputs changed/);
  });

  it('is stale when a source was deleted', () => {
    const f = fixture();
    const stamp = stampFor(f);
    fs.rmSync(path.join(f.src, 'nested', 'b.ts'));
    expect(unitStaleReason(f.unit, stamp)).toMatch(/inputs changed/);
  });

  it('is stale when an output is missing, and says which', () => {
    const f = fixture();
    const stamp = stampFor(f);
    fs.rmSync(f.out, { recursive: true });
    expect(unitStaleReason(f.unit, stamp)).toMatch(/not built \(no /);
  });

  it('becomes stale when something else writes into the output tree', () => {
    // A stray file, .DS_Store or another tool's output used to raise the "built at" baseline
    const f = fixture();
    const stamp = stampFor(f);
    fs.writeFileSync(path.join(f.out, '.DS_Store'), 'junk');
    fs.writeFileSync(path.join(f.out, '__probe.js'), 'probe');
    expect(unitStaleReason(f.unit, stamp)).toContain('outputs changed');
  });

  it('stays fresh when a source is dated in the future, so the check cannot loop', () => {
    // An output can never be newer than a future-dated source: the old check rebuilt every run and
    // still reported stale afterwards, telling the user to run what they had just run
    const f = fixture();
    const stamp = stampFor(f);
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    fs.utimesSync(path.join(f.src, 'a.ts'), future, future);
    expect(unitStaleReason(f.unit, stamp)).toBeNull();
  });

  it('ignores dot files and node_modules under a watched directory', () => {
    const f = fixture();
    const stamp = stampFor(f);
    fs.writeFileSync(path.join(f.src, '.DS_Store'), 'junk');
    fs.mkdirSync(path.join(f.src, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(f.src, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;');
    expect(unitStaleReason(f.unit, stamp)).toBeNull();
  });

  it('reports rather than throws when a source cannot be read', () => {
    const f = fixture();
    const stamp = stampFor(f);
    fs.chmodSync(f.src, 0o000);
    try {
      expect(unitStaleReason(f.unit, stamp)).toMatch(/could not be read/);
    } finally {
      fs.chmodSync(f.src, 0o755);
    }
  });
});

/**
 * Which input moved, for a report that has to name it rather than say a write happened.
 *
 * The shipped version of that report walked mtimes of its own, and the two answers disagreed the first time
 * it mattered: it named a compiled content that `tests/e2e/app-integration/dev-reload.spec.ts` rewrites with the bytes it already
 * had, and the diagnosis that followed was about the wrong file. Every case here is the pair of questions those
 * two walks answer differently — `it names nothing when only an mtime moved` is the one that fails on an mtime
 * walk, and is why this exists.
 */
describe('which inputs changed', () => {
  /** What a successful run records beside the fingerprint: the half that lets the next run explain itself */
  const recordFor = (unit: BuildUnit) => ({ files: fingerprintWithDigests(unit).files, declared: declaredPaths(unit) });
  // Through the same helper the subject uses, or these expectations disagree with it on Windows
  const rel = repoRelative;

  it('names the file whose bytes changed', () => {
    const f = fixture();
    const recorded = recordFor(f.unit);
    fs.writeFileSync(path.join(f.src, 'a.ts'), 'export const a = 2;\n');
    const changes = changedInputs(f.unit, recorded);
    expect(changes.changed).toEqual([rel(path.join(f.src, 'a.ts'))]);
    expect([...changes.added, ...changes.removed, ...changes.gained, ...changes.lost]).toEqual([]);
  });

  it('names nothing when only an mtime moved, which is what a walk of its own gets wrong', () => {
    const f = fixture();
    const recorded = recordFor(f.unit);
    const written = fs.readFileSync(path.join(f.src, 'a.ts'));
    // What a test that edits a file and puts it back does: the mtime moves twice, the bytes end where they were
    fs.writeFileSync(path.join(f.src, 'a.ts'), 'export const a = 2;\n');
    fs.writeFileSync(path.join(f.src, 'a.ts'), written);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    fs.utimesSync(path.join(f.src, 'nested', 'b.ts'), future, future);
    const changes = changedInputs(f.unit, recorded);
    expect([...changes.changed, ...changes.added, ...changes.removed]).toEqual([]);
    // And the verdict agrees there is nothing to explain, which is the property the two have to share
    expect(unitStaleReason(f.unit, stampFor(f))).toBeNull();
  });

  it('names an added file as added and a deleted one as removed', () => {
    const f = fixture();
    const recorded = recordFor(f.unit);
    fs.writeFileSync(path.join(f.src, 'c.ts'), 'export const c = 3;\n');
    fs.rmSync(path.join(f.src, 'nested', 'b.ts'));
    const changes = changedInputs(f.unit, recorded);
    expect(changes.added).toEqual([rel(path.join(f.src, 'c.ts'))]);
    expect(changes.removed).toEqual([rel(path.join(f.src, 'nested', 'b.ts'))]);
    expect(changes.changed).toEqual([]);
  });

  it('ignores a change under the unit\'s own output, as the fingerprint does', () => {
    const f = fixture();
    // The output inside the input tree, the shape that makes a step self-invalidating
    const nested = path.join(f.src, 'generated');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'emitted.ts'), 'export const emitted = 1;\n');
    const unit = { inputs: f.unit.inputs, outputs: [...f.unit.outputs, nested] };
    const recorded = recordFor(unit);
    fs.writeFileSync(path.join(nested, 'emitted.ts'), 'export const emitted = 2;\n');
    expect(changedInputs(unit, recorded).changed).toEqual([]);
  });

  it('says the declared set moved, and names no file, when a unit gains or loses a watched path', () => {
    const f = fixture();
    const recorded = recordFor(f.unit);
    // An excluded path that holds nothing: the declared set moves and not one byte under the inputs does
    const wider = { ...f.unit, excludes: [path.join(f.root, 'nowhere')] };
    const changes = changedInputs(wider, recorded);
    expect(changes.gained).toEqual([rel(path.join(f.root, 'nowhere'))]);
    expect([...changes.changed, ...changes.added, ...changes.removed]).toEqual([]);
    // Which is a real staleness, and the cause a file list cannot express
    expect(unitStaleReason(wider, stampFor(f))).toMatch(/inputs changed/);

    const narrower = { inputs: [f.unit.inputs[0]!], outputs: f.unit.outputs };
    expect(changedInputs(narrower, recorded).lost).toEqual([rel(path.join(f.root, 'package.json'))]);
  });

  it('collects a digest per file that the hash taken beside it agrees with', () => {
    const f = fixture();
    const files: Record<string, string> = {};
    const collected = fingerprintInputs(f.unit.inputs, [], (file, digest) => { files[file] = digest; });
    expect(collected, 'collecting moved the verdict').toBe(fingerprintInputs(f.unit.inputs));
    expect(Object.keys(files).map((file) => path.basename(file)).sort()).toEqual(['a.ts', 'b.ts', 'package.json']);
    const a = rel(path.join(f.src, 'a.ts'));
    expect(files[a]).toBe(createHash('sha256').update(fs.readFileSync(path.join(f.src, 'a.ts'))).digest('hex'));

    // The map's keys are the files the hash walked and no others, so a diff over it cannot name a file the
    // verdict never read. A declared input that is not there is not walked at all — `ABSENT` is for the
    // narrower case of a file that goes between the walk and the read, which the hash counts and so must this
    const absent = path.join(f.root, 'tsdown.config.ts');
    const missing: Record<string, string> = {};
    fingerprintInputs([...f.unit.inputs, absent], [], (file, digest) => { missing[file] = digest; });
    expect(missing[rel(absent)]).toBeUndefined();
    expect(Object.keys(missing).sort()).toEqual(Object.keys(files).sort());
    expect(ABSENT, 'the word the hash frames a vanished file with, so a digest map agrees with it').toBe('absent');
  });

  // Through the reader rather than by asserting the fields, which is the round trip worth holding: what the
  // writer records has to be what `diffableStamp` hands over, and nothing between them narrows by hand
  it('records what the next run reads back', async () => {
    const f = fixture();
    const stamp = path.join(f.root, 'stamp.json');
    await stampedRun('fixture', f.unit, stamp, () => {});
    const { stamp: recorded, undiffable } = diffableStamp(stampRecord(stamp));
    expect(undiffable, 'a run wrote a stamp its own reader will not diff').toBeUndefined();
    expect(changedInputs(f.unit, recorded!).changed).toEqual([]);
    fs.writeFileSync(path.join(f.src, 'a.ts'), 'export const a = 2;\n');
    expect(changedInputs(f.unit, recorded!).changed).toEqual([rel(path.join(f.src, 'a.ts'))]);
  });
});

/**
 * Asking about many units at one moment, over one reading of the tree.
 *
 * Units overlap: twelve chain steps declare 18,001 files between them and 3,518 distinct ones, so the primitive
 * reads the shared trees five times over. A sweep reads each once. What it buys is I/O, not a different
 * derivation — the fingerprints are the same ones — so the first case here is the equivalence everything else
 * rests on, and the rest are about the lifetime that equivalence depends on.
 */
describe('a freshness sweep', () => {
  it('gives the verdict an unshared check gives, for every unit it is asked about', () => {
    const [fresh, moved] = [fixture(), fixture()];
    const stamps = { fresh: stampFor(fresh), moved: stampFor(moved) };
    fs.writeFileSync(path.join(moved.src, 'a.ts'), 'export const a = 2;\n');
    const sweep = freshnessSweep();
    expect(sweep.staleReason(fresh.unit, stamps.fresh)).toBe(unitStaleReason(fresh.unit, stamps.fresh));
    expect(sweep.staleReason(moved.unit, stamps.moved)).toBe(unitStaleReason(moved.unit, stamps.moved));
    expect(sweep.staleReason(fresh.unit, stamps.fresh)).toBeNull();
    expect(sweep.staleReason(moved.unit, stamps.moved)).toMatch(/inputs changed/);
  });

  /**
   * Proven without reaching inside it: a file the sweep has already read stays readable to it after the
   * filesystem stops handing it over. An unshared check reports `could not be read` at that point, which is what
   * the second half asserts — so this fails the moment the sweep stops sharing.
   */
  it('reads each file once, however many units declare it', () => {
    const f = fixture();
    const stamp = stampFor(f);
    const shared = { inputs: f.unit.inputs, outputs: f.unit.outputs };
    const sweep = freshnessSweep();
    expect(sweep.staleReason(f.unit, stamp)).toBeNull();
    fs.chmodSync(path.join(f.src, 'a.ts'), 0o000);
    try {
      expect(sweep.staleReason(shared, stamp), 'the second unit read the file again').toBeNull();
      expect(unitStaleReason(shared, stamp), 'an unshared check should have hit the unreadable file').toMatch(/could not be read/);
    } finally {
      fs.chmodSync(path.join(f.src, 'a.ts'), 0o644);
    }
  });

  /**
   * The walk's half of the snapshot, which only a memoised walk can satisfy: a file that did not exist when the
   * sweep first looked at a target is not there for it, however many units declare that target afterwards.
   */
  it('does not see a file added after it started, where a later sweep does', () => {
    const f = fixture();
    const stamp = stampFor(f);
    const sweep = freshnessSweep();
    expect(sweep.staleReason(f.unit, stamp)).toBeNull();
    fs.writeFileSync(path.join(f.src, 'c.ts'), 'export const c = 3;\n');
    expect(sweep.staleReason(f.unit, stamp), 'it walked the target again').toBeNull();
    expect(freshnessSweep().staleReason(f.unit, stamp)).toMatch(/inputs changed/);
  });

  /** Why a sweep must be short-lived, asserted rather than left to its comment */
  it('does not see a change made after it started, where a later sweep does', () => {
    const f = fixture();
    const stamp = stampFor(f);
    const sweep = freshnessSweep();
    expect(sweep.staleReason(f.unit, stamp)).toBeNull();
    fs.writeFileSync(path.join(f.src, 'a.ts'), 'export const a = 2;\n');
    expect(sweep.staleReason(f.unit, stamp), 'it answered from a tree that has moved on').toBeNull();
    expect(freshnessSweep().staleReason(f.unit, stamp)).toMatch(/inputs changed/);
  });

  /** Memoising must never turn an unreadable tree into a fresh one, so the first read still has to fail loudly */
  it('reports a read that fails for any reason other than absence', () => {
    const f = fixture();
    const stamp = stampFor(f);
    fs.chmodSync(f.src, 0o000);
    try {
      expect(freshnessSweep().staleReason(f.unit, stamp)).toMatch(/could not be read/);
    } finally {
      fs.chmodSync(f.src, 0o755);
    }
  });

  it('finds the same changed inputs as a check that reads for itself', () => {
    const f = fixture();
    const recorded = { files: fingerprintWithDigests(f.unit).files, declared: declaredPaths(f.unit) };
    fs.writeFileSync(path.join(f.src, 'a.ts'), 'export const a = 2;\n');
    fs.rmSync(path.join(f.src, 'nested', 'b.ts'));
    expect(freshnessSweep().changedInputs(f.unit, recorded)).toEqual(changedInputs(f.unit, recorded));
  });
});

/**
 * Whether a stamp's digests may be diffed at all, which the verdict and the explanation have to agree on.
 *
 * The shape of what a run recorded is the clause an explainer forgets: it is read back as data, and one that
 * diffs a map whose values are not digests reports every file as changed, or throws on a declared set that is
 * not a list — printing a file name beside a reason saying the stamp could not be compared, on one line,
 * contradicting itself. Both halves get one message, because to a caller they are one thing.
 */
describe('the state a package build starts from', () => {
  it('moves with an input or an output and not with scratch or prose, and takes an output that is not there yet', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'one');
    fs.writeFileSync(path.join(root, 'src/CLAUDE.md'), 'prose');
    const unit = { inputs: [path.join(root, 'src')], outputs: [path.join(root, 'dist')] };
    const absent = packageBuildState([unit]);
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist/a.js'), 'built');
    const built = packageBuildState([unit]);
    expect(built).not.toBe(absent);
    fs.mkdirSync(path.join(root, 'src/.temp'));
    fs.writeFileSync(path.join(root, 'src/.temp/scratch.js'), 'scratch');
    fs.writeFileSync(path.join(root, 'src/CLAUDE.md'), 'more prose');
    expect(packageBuildState([unit])).toBe(built);
    fs.writeFileSync(path.join(root, 'dist/a.js'), 'built by the lock holder');
    const written = packageBuildState([unit]);
    expect(written).not.toBe(built);
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'two');
    expect(packageBuildState([unit])).not.toBe(written);
  });
});

describe('diffableStamp', () => {
  const why = (record: Parameters<typeof diffableStamp>[0]) => diffableStamp(record).undiffable ?? null;
  const complete = { fingerprint: 'abc', declared: ['packages/x/src'], files: { 'packages/x/src/a.ts': 'd' } };

  // It hands back the record, not a verdict about it: the whole point of one reader is that a caller holding
  // this object has already been told the fields are readable and never narrows for itself
  it('hands a complete stamp over, with the brackets of the run that wrote it', () => {
    expect(diffableStamp({ ...complete, takenAt: 'a', builtAt: 'b' })).toEqual({
      stamp: { ...complete, takenAt: 'a', builtAt: 'b' },
    });
    expect(diffableStamp({ ...complete, takenAt: 7 }).stamp?.takenAt, 'a time that is not a string is no time')
      .toBeUndefined();
  });

  /**
   * The two shapes that can give a confidently wrong answer, which is what this clause is for: a map of
   * non-digests makes `changedInputs` report every file as changed, and a declared set that is not a list makes
   * it throw. Both are visible in the bytes, which is why no version has to be remembered for them.
   */
  it('refuses a digest map whose values are not digests', () => {
    expect(why({ ...complete, files: { 'packages/x/src/a.ts': 7 } }))
      .toBe('its record of what it read is in a shape this cannot read');
  });

  it('refuses a declared set that is not a list of paths', () => {
    expect(why({ ...complete, declared: { 'packages/x/src': true } }))
      .toBe('its record of what it read is in a shape this cannot read');
  });

  /**
   * **Being a list is not the clause**, and the case above reaches only that half. A list of the wrong thing
   * is the shape that gets through: `new Set([1, 2])` makes `changedInputs` report every path this unit
   * declares as gained and every number as lost, which is a confident answer about a tree nothing read.
   */
  it('refuses a declared set that is a list of something other than paths', () => {
    expect(why({ ...complete, declared: [1, 2] }))
      .toBe('its record of what it read is in a shape this cannot read');
  });

  /** The mirror, and why a digest map is asked whether it is an array: `Object.values` of one is all strings */
  it('refuses a digest map that is an array', () => {
    expect(why({ ...complete, files: ['d', 'e'] }))
      .toBe('its record of what it read is in a shape this cannot read');
  });

  it('refuses one with nothing to diff against', () => {
    expect(why(undefined)).toBe('has not run yet');
    expect(why({})).toBe('has not run yet');
    expect(why({ fingerprint: 'abc' })).toBe('its last run recorded no per-file digests');
  });

  /** In `unitStaleReason`'s order, so the two cannot disagree about which complaint comes first */
  it('reports a missing fingerprint before a record it cannot read', () => {
    expect(why({ files: 5 })).toBe('has not run yet');
  });

  /**
   * One predicate, asked twice. These two answered differently for a non-string fingerprint — `has not run yet`
   * from the explainer and `another format` from the verdict — which is the self-contradicting line this whole
   * block exists to prevent, reachable through a door the version clause was standing beside rather than in.
   */
  it('agrees with unitStaleReason about what a fingerprint is', () => {
    const f = fixture();
    for (const fingerprint of [null, 42, undefined, {}]) {
      const stamp = path.join(f.root, 'stamp.json');
      fs.writeFileSync(stamp, JSON.stringify({ fingerprint, declared: [], files: {} }));
      expect(why({ fingerprint, declared: [], files: {} }), String(fingerprint)).toBe('has not run yet');
      expect(unitStaleReason(f.unit, stamp), String(fingerprint)).toMatch(/no stamp/);
    }
  });
});

describe('the stale message', () => {
  it('names every stale workspace with its own reason', () => {
    const message = staleMessage([
      { workspace: '@apackdev/sdk', reason: 'its inputs changed since the last successful run' },
      { workspace: '@apackdev/ui', reason: 'no stamp' },
    ]);
    expect(message.split('\n')).toHaveLength(2);
    expect(message).toContain('@apackdev/sdk: its inputs changed');
    expect(message).toContain('@apackdev/ui: no stamp');
  });

  /**
   * The reason is the same sentence for every healthy unit — `its inputs changed since the last successful run`
   * is the only verdict one can have — so it is the file that tells the five callers of this message apart. Four
   * of them are a refusal someone is stopped by, including the one a pack author reads about a checkout that may
   * not be theirs.
   */
  it('names what moved, after the reason that is the same for all of them', () => {
    const message = staleMessage([
      { workspace: '@apackdev/sdk', reason: INPUTS_CHANGED, moved: 'changed src/types/entities.ts (and 2 more)' },
    ]);
    expect(message).toBe('  @apackdev/sdk: its inputs changed since the last successful run — changed src/types/entities.ts (and 2 more)');
  });

  /**
   * A suffix rather than a line of its own, because a reader counts these against the "Rebuilding N of M" printed
   * under them — which is what the case above pins, and why it needed no edit when this arrived.
   */
  it('keeps one line per unit whether or not it can say what moved', () => {
    const message = staleMessage([
      { workspace: '@apackdev/sdk', reason: INPUTS_CHANGED, moved: 'changed src/a.ts' },
      { workspace: '@apackdev/ui', reason: INPUTS_CHANGED },
    ]);
    expect(message.split('\n')).toHaveLength(2);
    expect(message.split('\n')[1], 'a stamp from before the digests existed still reads as it did')
      .toBe('  @apackdev/ui: its inputs changed since the last successful run');
  });
});

describe('a stamped build', () => {
  /** stampedBuild against a fixture: its own stamp and lock, never the repo's */
  // Pinned to `command` rather than left to `intentFromEnv()`, so a test reads the same whatever
  // APACK_APP_INTENT the run inherited
  const run = (f: Fixture, build: () => void | Promise<void>, intent: BuildIntent = 'command') =>
    stampedBuild('@apackdev/fixture', f.unit, path.join(f.root, 'stamp.json'), build, { lock: path.join(f.root, 'build.lock'), intent });

  it('leaves the unit fresh when the build returns', async () => {
    const f = fixture();
    await run(f, () => fs.writeFileSync(path.join(f.out, 'built.js'), 'ok'));
    expect(unitStaleReason(f.unit, path.join(f.root, 'stamp.json'))).toBeNull();
  });

  it('leaves no stamp when the build throws, however complete its output looks', async () => {
    const f = fixture();
    await run(f, () => {});
    await expect(run(f, () => {
      fs.rmSync(f.out, { recursive: true, force: true }); // as every build starts
      fs.mkdirSync(f.out, { recursive: true });
      fs.writeFileSync(path.join(f.out, 'half.js'), 'partial');
      throw new Error('tsc failed');
    })).rejects.toThrow('tsc failed');
    expect(fs.existsSync(path.join(f.root, 'stamp.json'))).toBe(false);
    expect(unitStaleReason(f.unit, path.join(f.root, 'stamp.json'))).toMatch(/no stamp/);
  });

  /**
   * The other half of the atomic swap, and without it the swap buys nothing. A build that renames its output
   * into place never publishes a half-built tree — but a reader mid-build asks the *stamp*, and a stamp removed
   * before the run reads as `'no stamp'`, which is stale, which is the wait the rename was meant to remove.
   *
   * So this is the one a reader cares about: throughout the build, the previous build is **fresh**, not merely
   * present. The build that mutates its output in place keeps the opposite contract, which is why the option is
   * the caller's — `stampedRunAll`'s comment has the two kills side by side.
   */
  it('leaves the previous build fresh while an atomic build runs, since there is no half-built tree to disown', async () => {
    const f = fixture();
    await run(f, () => fs.writeFileSync(path.join(f.out, 'built.js'), 'ok'));
    let reasonDuringBuild: string | null = 'never asked';
    await run(f, () => { reasonDuringBuild = unitStaleReason(f.unit, path.join(f.root, 'stamp.json')); });
    expect(reasonDuringBuild).toBeNull();
  });

  it('records the sources as they were before the build, so a mid-build edit stays stale', async () => {
    const f = fixture();
    await run(f, () => fs.writeFileSync(path.join(f.src, 'a.ts'), 'export const a = 99;\n'));
    expect(unitStaleReason(f.unit, path.join(f.root, 'stamp.json'))).toMatch(/inputs changed/);
  });

  it('rebuilds a fresh unit for a command and skips it for a freshness fix', async () => {
    const f = fixture();
    await run(f, () => fs.writeFileSync(path.join(f.out, 'built.js'), 'ok'));
    expect(unitStaleReason(f.unit, path.join(f.root, 'stamp.json'))).toBeNull();

    // The second arrival of two racing freshness fixes: the first built it while this one waited, so
    // there is nothing left to do. A command was asked for a build and gets one.
    let built = false;
    await run(f, () => { built = true; }, 'freshness');
    expect(built, 'a freshness fix rebuilt a unit that was already fresh').toBe(false);

    await run(f, () => { built = true; }, 'command');
    expect(built, 'a command skipped a build it was asked for').toBe(true);
  });

  it('holds the build lock while it runs', async () => {
    const f = fixture();
    const lock = path.join(f.root, 'build.lock');
    await run(f, async () => {
      await expect(withBuildLock('@apackdev/other', () => 'never', lock)).rejects.toThrow(/another package build holds/);
    });
    expect(fs.existsSync(lock)).toBe(false);
  });
});

/**
 * That the build lock is hung on an interrupt at all.
 *
 * Node runs no `exit` handler for a signal, so without these a Ctrl-C'd `packages:build` left its lock behind
 * for the next arrival to take over — which works, and costs that arrival the wait plus a message about a
 * holder that is gone. **What is asked here is the registration, not the release**: that a `SIGINT` handler
 * removes the file is `exclusive-lock.ts`'s behaviour, and `apack-host/tests/database/write-lock.spec.ts`
 * already proves it with a real spawned holder per signal. Counting listeners is the part that is this
 * lock's own, and it is cheap.
 */
describe('the build lock on the way out', () => {
  const listeners = () => ({
    exit: process.listenerCount('exit'),
    ...Object.fromEntries(INTERRUPTS.filter((s) => s in os.constants.signals).map((s) => [s, process.listenerCount(s)])),
  });

  it('registers a release for exit and every interrupt, and takes them off again', async () => {
    const file = path.join(tempDir(), 'packages-build.lock');
    const before = listeners();
    let during: ReturnType<typeof listeners> | undefined;

    await withBuildLock('@apackdev/sdk', () => { during = listeners(); }, file);

    for (const [signal, count] of Object.entries(before)) {
      expect(during![signal as keyof typeof before], `${signal} while the lock was held`).toBe(count + 1);
    }
    expect(listeners(), 'and off again, or a process taking many locks piles them up').toEqual(before);
  });

  // A throw must not leave them behind either: the release is in the `finally`, not after `run()`
  it('takes them off when the work throws', async () => {
    const file = path.join(tempDir(), 'packages-build.lock');
    const before = listeners();

    await expect(withBuildLock('@apackdev/sdk', () => { throw new Error('boom'); }, file)).rejects.toThrow('boom');

    expect(listeners()).toEqual(before);
    expect(fs.existsSync(file), 'and the lock itself is gone').toBe(false);
  });
});

describe('the build lock', () => {
  const lockFile = () => path.join(tempDir(), 'packages-build.lock');

  it('refuses a second build while one holds it', async () => {
    const file = lockFile();
    await withBuildLock('@apackdev/sdk', async () => {
      await expect(withBuildLock('@apackdev/ui', () => 'never', file)).rejects.toThrow(/another package build holds/);
    }, file);
  });

  it('waits for a live holder when the build is a freshness fix, where a command fails at once', async () => {
    const file = lockFile();
    // This process is the holder, so it is alive for certain and the test cannot race its exit
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, label: '@apackdev/other', startedAt: new Date().toISOString() }));

    const started = Date.now();
    await expect(withBuildLock('@apackdev/sdk', () => 'never', file, { intent: 'command' })).rejects.toThrow(/another package build holds/);
    expect(Date.now() - started, 'a command waited instead of failing at once').toBeLessThan(500);

    // The wait is bounded, and says it waited — a holder that never goes is reported, not waited on forever
    const waited = Date.now();
    await expect(withBuildLock('@apackdev/sdk', () => 'never', file, { intent: 'freshness', timeoutMs: 1_000 }))
      .rejects.toThrow(/after waiting 1s/);
    expect(Date.now() - waited, 'a freshness fix gave up without waiting').toBeGreaterThanOrEqual(900);
  });

  it('names the holder', async () => {
    const file = lockFile();
    await withBuildLock('@apackdev/sdk', async () => {
      await expect(withBuildLock('@apackdev/ui', () => 'never', file)).rejects.toThrow(new RegExp(`pid ${process.pid}.*@apackdev/sdk`));
    }, file);
  });

  it('releases it afterwards, including when the build throws', async () => {
    const file = lockFile();
    await expect(withBuildLock('@apackdev/sdk', () => { throw new Error('build failed'); }, file)).rejects.toThrow('build failed');
    expect(fs.existsSync(file)).toBe(false);
    await expect(withBuildLock('@apackdev/ui', () => 'ok', file)).resolves.toBe('ok');
  });

  it('takes over a lock whose process is gone — a killed build must not block the next one', async () => {
    const file = lockFile();
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    fs.writeFileSync(file, JSON.stringify({ pid: dead, label: '@apackdev/sdk', startedAt: new Date().toISOString() }));
    await expect(withBuildLock('@apackdev/ui', () => 'ok', file)).resolves.toBe('ok');
  });

  it('leaves a lock it no longer owns alone', async () => {
    const file = lockFile();
    const other = JSON.stringify({ pid: process.pid + 1, label: '@apackdev/ui', startedAt: new Date().toISOString() });
    await withBuildLock('@apackdev/sdk', () => fs.writeFileSync(file, other), file);
    expect(fs.readFileSync(file, 'utf-8')).toBe(other);
  });
});

// The write side of the protocol. The read side is above; these are the two functions that put a stamp on
// disk, and nothing tested them — including the ordering `stampedRunAll` exists for, which is the whole
// reason it is not a loop over `stampedRun`.
describe('recording that something ran', () => {
  it('leaves the unit fresh, and clears the stamp first so an interrupted run reads as never run', async () => {
    const f = fixture();
    const stamp = path.join(f.root, 'stamp.json');
    fs.writeFileSync(stamp, JSON.stringify({ fingerprint: 'stale' }));

    let stampPresentDuringRun = true;
    await stampedRun('a-unit', f.unit, stamp, () => { stampPresentDuringRun = fs.existsSync(stamp); });

    expect(stampPresentDuringRun, 'a run that dies halfway would leave the old stamp readable').toBe(false);
    expect(unitStaleReason(f.unit, stamp)).toBeNull();
  });

  // The fingerprint is of the tree the run *started* from, so work the run itself does is not recorded as
  // covered. A source edited while a build runs must read as stale afterwards, not as built.
  it('fingerprints before the run, so a change made during it is not recorded as covered', async () => {
    const f = fixture();
    const stamp = path.join(f.root, 'stamp.json');
    await stampedRun('a-unit', f.unit, stamp, () => {
      fs.writeFileSync(path.join(f.src, 'a.ts'), 'export const a = 99;\n');
    });
    expect(unitStaleReason(f.unit, stamp)).toMatch(/inputs changed/);
  });

  it('writes no stamp when the run throws', async () => {
    const f = fixture();
    const stamp = path.join(f.root, 'stamp.json');
    await expect(stampedRun('a-unit', f.unit, stamp, () => { throw new Error('the build failed'); })).rejects.toThrow('the build failed');
    expect(fs.existsSync(stamp)).toBe(false);
  });

  describe('a run that covers several units', () => {
    const two = () => {
      const [a, b] = [fixture(), fixture()];
      return { a, b, stamps: { a: path.join(a.root, 'stamp.json'), b: path.join(b.root, 'stamp.json') } };
    };

    it('stamps all of them when it passes', async () => {
      const { a, b, stamps } = two();
      await stampedRunAll([{ label: 'a', unit: a.unit, stamp: stamps.a }, { label: 'b', unit: b.unit, stamp: stamps.b }], () => {});
      expect(unitStaleReason(a.unit, stamps.a)).toBeNull();
      expect(unitStaleReason(b.unit, stamps.b)).toBeNull();
    });

    it('stamps none of them when it throws, so a failure leaves the whole run unrecorded', async () => {
      const { a, b, stamps } = two();
      await expect(stampedRunAll([{ label: 'a', unit: a.unit, stamp: stamps.a }, { label: 'b', unit: b.unit, stamp: stamps.b }], () => {
        throw new Error('the suite failed');
      })).rejects.toThrow('the suite failed');
      expect(fs.existsSync(stamps.a)).toBe(false);
      expect(fs.existsSync(stamps.b)).toBe(false);
    });

    // This is what it is for. A loop of `stampedRun` would fingerprint the second unit *after* the shared
    // run had already started touching the tree, recording work the run had done as work it was verified
    // against. Every fingerprint is taken before anything runs.
    it('fingerprints every unit before the run starts, not as each is reached', async () => {
      const { a, b, stamps } = two();
      await stampedRunAll([{ label: 'a', unit: a.unit, stamp: stamps.a }, { label: 'b', unit: b.unit, stamp: stamps.b }], () => {
        fs.writeFileSync(path.join(b.src, 'a.ts'), 'export const a = 42;\n');
      });
      expect(unitStaleReason(a.unit, stamps.a), 'a was untouched by the run').toBeNull();
      expect(unitStaleReason(b.unit, stamps.b), 'b changed during the run and must not read as covered').toMatch(/inputs changed/);
    });
  });
});

/**
 * What a caller that has already built the packages does when one is stale anyway.
 *
 * The refusal exists because building here would race whatever is rewriting that dist, and the failure would
 * then be about the race — `building @apackdev/sdk failed` — rather than about the tree having moved. Both halves
 * were checked by hand when it was written (2026-09-24) and neither became a case, next to a flag nothing set,
 * so for eight days the branch could not run at all: the `@apackdev/source` condition, the chain, and every
 * suite's pretest all went through the other side of it.
 *
 * Driven through `EnsurePackagesOptions` rather than by making a real package stale, which would mean deleting
 * a cache stamp every other suite in the checkout is reading.
 */
/**
 * The middle arm of `packageWriter`: a lock still on disk. None of the three states that produces is the
 * ordinary case — a crashed writer, one wedged past the wait's bound, or one that arrived between the wait
 * returning and the stamps being read — and whether it is still running is what tells them apart.
 *
 * Asked of `packageWriter` directly, with a lock file of its own: reaching this through
 * `ensurePackagesBuilt` would mean holding the repo's real lock to assert a message.
 */
describe('a lock still on disk when the packages went stale', () => {
  const lockAt = (holder: unknown): string => {
    const file = path.join(tempDir(), 'packages-build.lock');
    fs.writeFileSync(file, JSON.stringify(holder));
    return file;
  };

  it('names a holder that is still running', () => {
    // This process: its pid exists and it started in this boot, which is what `holderIsRunning` asks
    const file = lockAt({ pid: process.pid, label: '@apackdev/ui', startedAt: new Date().toISOString() });

    const writer = packageWriter(undefined, file);

    expect(writer).toContain(`pid ${process.pid} (@apackdev/ui`);
    expect(writer).toContain('is still running');
  });

  // A crashed writer's record outlives it, and before this nothing read it
  it('names a holder that is gone, and says its lock was left behind', () => {
    const file = lockAt({ pid: process.pid, label: '@apackdev/sdk', startedAt: new Date(Date.now() - (os.uptime() + 3600) * 1000).toISOString() });

    const writer = packageWriter(undefined, file);

    expect(writer).toContain('@apackdev/sdk');
    expect(writer).toContain('is gone, having left its lock behind');
  });

  it('says the lock could not be read rather than inventing a holder', () => {
    const file = lockAt('not a lock');

    expect(packageWriter(undefined, file)).toContain('an unreadable lock file');
  });

  /**
   * And the wait wins over the file. A writer that finished and a *different* one that has since taken the
   * lock are two facts, and the one that moved these packages is the one this run waited for.
   */
  it('prefers what the wait saw over a lock taken since', () => {
    const file = lockAt({ pid: process.pid, label: '@apackdev/ui', startedAt: new Date().toISOString() });

    expect(packageWriter('pid 99 (@apackdev/ears, started then)', file)).toContain('@apackdev/ears');
  });
});

describe('ensurePackagesBuilt, where the caller says the packages are already built', () => {
  const moved: StaleUnit[] = [{ workspace: '@apackdev/sdk', reason: INPUTS_CHANGED, moved: 'src/index.ts' }];

  /** Restored rather than stubbed: this process is a test runner, and the flag changes what every later case sees */
  function withFlag<T>(value: string | undefined, body: () => T): T {
    const before = process.env[PACKAGES_PREBUILT_ENV];
    if (value === undefined) delete process.env[PACKAGES_PREBUILT_ENV];
    else process.env[PACKAGES_PREBUILT_ENV] = value;
    try {
      return body();
    } finally {
      if (before === undefined) delete process.env[PACKAGES_PREBUILT_ENV];
      else process.env[PACKAGES_PREBUILT_ENV] = before;
    }
  }

  /** The refusal's message, for a `wait` that saw whatever the case says it saw */
  function refusalWith(wait: () => string | undefined): { refusal: string; built: string[]; reported: string[] } {
    const built: string[] = [];
    const reported: string[] = [];
    const run = () => ensurePackagesBuilt({ wait, stale: () => moved, build: (w) => built.push(w), report: (m) => reported.push(m) });
    const refusal = withFlag('1', () => {
      try {
        run();
        return '';
      } catch (err) {
        return (err as Error).message;
      }
    });
    return { refusal, built, reported };
  }

  it('reports what moved and builds nothing', () => {
    const { refusal, built, reported } = refusalWith(() => undefined);

    expect(() => withFlag('1', () => ensurePackagesBuilt({ wait: () => undefined, stale: () => moved, build: () => {}, report: () => {} })))
      .toThrow(PackagesWentStale);
    expect(built, 'it built under the flag, which is the race the refusal exists to avoid').toEqual([]);
    expect(reported, 'the refusal carries the message; printing one too says it twice').toEqual([]);
    expect(refusal).toContain('@apackdev/sdk');
    expect(refusal, 'a reader has to be told which file moved, or the refusal names no suspect')
      .toContain('src/index.ts');
  });

  /**
   * **Who** moved it, which is the half that used to be a guess: the message named `packages:build` as "the
   * usual cause" whatever had happened, so a reader chasing it had nothing to check. The three arms are the
   * three states the evidence can be in, and each says only what it has.
   *
   * The first is the ordinary one and the only one that can answer it. By the time staleness is read the
   * writer has finished — that is what let this run past the wait — so the lock is gone and what the wait
   * returned is all there is.
   */
  it('names the build it waited for, which is the only evidence in the ordinary case', () => {
    const { refusal } = refusalWith(() => 'pid 4821 (@apackdev/ui, started 2026-10-08T00:43:43.374Z)');

    expect(refusal, 'the writer, named').toContain('pid 4821 (@apackdev/ui, started 2026-10-08T00:43:43.374Z)');
    expect(refusal).toContain('held the build lock during this run and released it');
    expect(refusal, 'the guess it replaces').not.toMatch(/usual cause/);
  });

  // Nothing took the lock, so it was something that does not take it. A fact, not a shrug — and the
  // 2026-10-07 case, where two sessions shared a checkout and an editor was the writer
  it('says so when nothing took the build lock', () => {
    const { refusal } = refusalWith(() => undefined);

    expect(refusal).toContain('nothing took the build lock');
    expect(refusal, 'what that leaves, so the reader knows where to look').toMatch(/an editor, a tool outside the lock, or another session/);
    expect(refusal, 'no pid it does not have').not.toMatch(/pid \d/);
  });

  // The other direction, which is every ordinary caller: the same staleness is work to do, not a refusal
  it('builds the stale workspace when no caller claims to have built it', () => {
    const built: string[] = [];
    withFlag(undefined, () => ensurePackagesBuilt({ wait: () => undefined, stale: () => moved, build: (w) => built.push(w), report: () => {} }));
    expect(built).toEqual(['@apackdev/sdk']);
  });

  /**
   * And the wait comes first, which is the reason it is injectable at all.
   *
   * Reading the stamps while another process is rewriting them is the race `waitForPackageBuild` exists to
   * avoid, so the order is the behaviour, not an implementation detail. It was unreachable from a test until
   * `wait` joined the options: the three injected answers were consulted only after this had taken the repo's
   * real lock.
   */
  it('waits for a build already in flight before it reads any stamp', () => {
    const order: string[] = [];
    ensurePackagesBuilt({
      wait: () => { order.push('wait'); return undefined; },
      stale: () => { order.push('stale'); return []; },
      build: () => order.push('build'),
      report: () => {},
    });
    expect(order).toEqual(['wait', 'stale']);
  });

  it('is a no-op when nothing is stale, whichever the caller is', () => {
    for (const flag of ['1', undefined]) {
      const built: string[] = [];
      withFlag(flag, () => ensurePackagesBuilt({ wait: () => undefined, stale: () => [], build: (w) => built.push(w), report: () => {} }));
      expect(built).toEqual([]);
    }
  });
});


it.each(['bin/compiler-windows.ps1', 'templates/pack.json'])('refuses deleted or changed copied CLI output: %s', target => {
  const f = fixture();
  const cliRoot = path.join(REPO_ROOT, 'packages/apack-cli');
  const output = path.join(f.root, 'dist/package');
  const unit: BuildUnit = { inputs: [f.src], outputs: BUILD_UNITS['@apackdev/cli'].outputs.map(file => path.join(f.root, path.relative(cliRoot, file))) };
  for (const [file, bytes] of [['package.json', '{}'], ['dist/cli.js', 'export {};'], ['bin/compiler-windows.ps1', 'launcher'], ['templates/pack.json', '{}']]) {
    const destination = path.join(output, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
  }
  const stamp = stampFor({ ...f, unit });
  expect(unitStaleReason(unit, stamp)).toBeNull();
  const file = path.join(output, target);
  const original = fs.readFileSync(file);
  fs.rmSync(file);
  expect(unitStaleReason(unit, stamp)).toMatch(/outputs changed/);
  fs.writeFileSync(file, original);
  expect(unitStaleReason(unit, stamp)).toBeNull();
  fs.writeFileSync(file, 'changed');
  expect(unitStaleReason(unit, stamp)).toMatch(/outputs changed/);
});
