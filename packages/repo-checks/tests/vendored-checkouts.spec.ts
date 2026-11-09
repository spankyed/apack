// Two pieces of tooling resolved `vendor/elmdb` by name: the janitor's budget, which left a second Rust
// checkout outside it entirely (48 MB from one dependency and one build, with an hourly job reporting
// nothing about it), and the Linux container's image, which built that checkout under elmdb's toolchain
// without saying so. Both derive their subject now, and each case here mutates that subject rather than
// describing it.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { CHAIN_STEPS } from '../../../scripts/lib/chain-steps.ts';
import { readsOf } from '../../../scripts/lib/dep-files.ts';
import {
  type PinnedToolchain, type VendoredCheckout, oneRustToolchain, rustCheckoutsIn,
} from '../../../scripts/lib/vendored-checkouts.ts';

/**
 * What one container run has to build, which is **not** the same question as what is linked.
 *
 * `rustCheckoutsIn` refuses an empty `vendor/`, which is right for the janitor — its only source *is*
 * `vendor/`. Asking it for the *others* made `test:linux` refuse when nothing else was linked, although the
 * native source it had been given was present: the documented frozen-checkout qualification names that source
 * in `APACK_LINUX_ELMDB_ROOT` and needs no link at all, and the run exited 1 saying to run `link:elmdb`.
 */
describe('rustCheckoutsIn', () => {
  const linked = (name: string, isRustCheckout = true): VendoredCheckout =>
    ({ name, path: `/checkouts/${name}`, isRustCheckout });

  // The subject is mutated here rather than described: the janitor resolved `vendor/elmdb` by name, so a
  // second Rust checkout was outside the budget entirely — 48 MB from one dependency and one build, with an
  // hourly job reporting nothing about it. Adding a link has to change the answer.
  it('answers every linked Rust checkout, so a new one is covered the day it is linked', () => {
    expect(rustCheckoutsIn([linked('elmdb')])).toEqual(['/checkouts/elmdb']);
    expect(rustCheckoutsIn([linked('elmdb'), linked('apack-terminal')]))
      .toEqual(['/checkouts/elmdb', '/checkouts/apack-terminal']);
  });

  it('answers only the ones holding a Cargo.toml, which is what makes a checkout Rust', () => {
    expect(rustCheckoutsIn([linked('elmdb'), linked('some-js-thing', false)])).toEqual(['/checkouts/elmdb']);
  });

  // A janitor that resolves nothing reports a budget it holds nothing to, every hour
  it('refuses an empty set rather than answering one, and says what it found', () => {
    expect(() => rustCheckoutsIn([])).toThrow(/nothing is linked there/);
    expect(() => rustCheckoutsIn([linked('notes', false), linked('fixtures', false)]))
      .toThrow(/notes, fixtures are, none holding a Cargo\.toml/);
    expect(() => rustCheckoutsIn([])).toThrow(/link:elmdb/);
  });
});

describe('oneRustToolchain', () => {
  const pins = (path: string, channel: string | undefined): PinnedToolchain => ({ path, channel });

  it('answers the channel every checkout agrees on, which is the one the image installs', () => {
    expect(oneRustToolchain([pins('/checkouts/elmdb', '1.99.1')])).toBe('1.99.1');
    expect(oneRustToolchain([pins('/checkouts/elmdb', '1.99.1'), pins('/checkouts/apack-terminal', '1.99.1')]))
      .toBe('1.99.1');
  });

  // Picking one was the old behaviour by omission: the second checkout built under elmdb's pin, as a
  // compile error in code correct against its own, with nothing saying which pin to look at
  it('refuses a disagreement and names both pins, rather than choosing a winner', () => {
    const disagreeing = [pins('/checkouts/elmdb', '1.99.1'), pins('/checkouts/apack-terminal', '1.98.0')];
    expect(() => oneRustToolchain(disagreeing)).toThrow(/\/checkouts\/elmdb pins 1\.99\.1/);
    expect(() => oneRustToolchain(disagreeing)).toThrow(/\/checkouts\/apack-terminal pins 1\.98\.0/);
  });

  it('refuses a checkout that pins nothing, naming the file it looked in', () => {
    expect(() => oneRustToolchain([pins('/checkouts/elmdb', '1.99.1'), pins('/checkouts/new-thing', undefined)]))
      .toThrow(/\/checkouts\/new-thing\/rust-toolchain\.toml/);
  });

  it('refuses an empty set rather than answering a default nobody pinned', () => {
    expect(() => oneRustToolchain([])).toThrow(/link:elmdb/);
  });
});

/**
 * The third thing that resolved `vendor/elmdb` by name, and the one only CI could catch.
 *
 * A vendored checkout is a dependency: its reads are dropped from a dep file because the pin beside it is what
 * every step declares instead. Both halves named elmdb, so when `apack-terminal` became the second checkout no
 * leg re-ran on its commit and five legs read two files nothing declared. Locally neither half can fail — a
 * sibling checkout's reads resolve outside the repo and are dropped as `..` — so these ask the declaration and
 * the filter directly, over a pin that is not elmdb's.
 */
describe('every vendored checkout is covered, not the one that was there first', () => {
  const pins = fs.readdirSync(path.join(REPO_ROOT, 'vendor')).filter((name) => name.endsWith('.rev')).sort();

  it('has a pin for something other than elmdb, or these cases describe nothing', () => {
    expect(pins.length, 'vendor/ holds one pin, so nothing here distinguishes derived from named').toBeGreaterThan(1);
  });

  /**
   * The pins travel together, which is what a derivation gives and a written name cannot.
   *
   * Not "every step declares them": `packages:ensure` declares the lockfile and no pin, naming the five
   * packages it builds instead, and two earlier spellings of this case reported it as a defect when it is the
   * documented difference between a scope and `ROOT`. What is actually in question is whether a step that
   * cares about one checkout cares about all of them — so the population is the steps declaring any pin, and
   * the edit that fires this is the one that regressed: writing a checkout's name in `ROOT` again, which
   * covers the one that was there first and no other.
   */
  it('declares either every pin or none, in each step that declares one', () => {
    const declaring = CHAIN_STEPS.filter((step) => pins.some((pin) => step.inputs.includes(`vendor/${pin}`)));
    expect(declaring.length, 'no step declares any pin, so this compares nothing').toBeGreaterThan(1);
    const partial = declaring
      .filter((step) => !pins.every((pin) => step.inputs.includes(`vendor/${pin}`)))
      .map((step) => `${step.name} declares only ${pins.filter((pin) => step.inputs.includes(`vendor/${pin}`)).join(', ')}`);
    expect(partial, 'a step reading one vendored checkout reads the commits of all of them').toEqual([]);
  });

  it.each(pins)('drops a read inside the checkout vendor/%s pins, the pin standing for it', (pin) => {
    const checkout = `vendor/${pin.replace(/\.rev$/, '')}`;
    const read = [...new Set(depFiles().flatMap((name) => readsOf(name) ?? []))]
      .filter((file) => file.startsWith(`${checkout}/`));
    expect(read, `${checkout} is a dependency; its pin is what steps declare`).toEqual([]);
  });

  function depFiles(): string[] {
    const dir = path.join(REPO_ROOT, 'node_modules', '.cache', 'apack-typecheck');
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.tsbuildinfo')) : [];
  }
});
