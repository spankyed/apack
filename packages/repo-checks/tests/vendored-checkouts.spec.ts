// Two pieces of tooling resolved `vendor/elmdb` by name: the janitor's budget, which left a second Rust
// checkout outside it entirely (48 MB from one dependency and one build, with an hourly job reporting
// nothing about it), and the Linux container's image, which built that checkout under elmdb's toolchain
// without saying so. Both derive their subject now, and each case here mutates that subject rather than
// describing it.
import { describe, expect, it } from 'vitest';
import {
  type PinnedToolchain, type VendoredCheckout, oneRustToolchain, rustCheckoutsForRun, rustCheckoutsIn,
} from '../../../scripts/lib/vendored-checkouts.ts';

/**
 * What one container run has to build, which is **not** the same question as what is linked.
 *
 * `rustCheckoutsIn` refuses an empty `vendor/`, which is right for the janitor — its only source *is*
 * `vendor/`. Asking it for the *others* made `test:linux` refuse when nothing else was linked, although the
 * native source it had been given was present: the documented frozen-checkout qualification names that source
 * in `APACK_LINUX_ELMDB_ROOT` and needs no link at all, and the run exited 1 saying to run `link:elmdb`.
 */
describe('rustCheckoutsForRun', () => {
  const linked = (name: string, isRustCheckout = true): VendoredCheckout =>
    ({ name, path: `/checkouts/${name}`, isRustCheckout });

  // The firing case: the old call threw here, and the run exited 1 with a source it had already resolved
  it('answers the native source alone when nothing is linked', () => {
    expect(rustCheckoutsForRun('/frozen/elmdb', undefined, [])).toEqual(['/frozen/elmdb']);
  });

  it('adds every other linked Rust checkout, so one pinning another channel is weighed', () => {
    expect(rustCheckoutsForRun('/checkouts/elmdb', '/checkouts/elmdb', [linked('elmdb'), linked('apack-terminal')]))
      .toEqual(['/checkouts/elmdb', '/checkouts/apack-terminal']);
  });

  // A frozen copy *replaces* the developer's link rather than joining it, so the two are never weighed
  // against each other for a toolchain — which is what `APACK_LINUX_ELMDB_ROOT` is for
  it('leaves out the link the native source stands in for', () => {
    expect(rustCheckoutsForRun('/frozen/elmdb', '/checkouts/elmdb', [linked('elmdb'), linked('apack-terminal')]))
      .toEqual(['/frozen/elmdb', '/checkouts/apack-terminal']);
  });

  it('names the native source once when it is the link itself', () => {
    expect(rustCheckoutsForRun('/checkouts/elmdb', '/checkouts/elmdb', [linked('elmdb')]))
      .toEqual(['/checkouts/elmdb']);
  });

  it('ignores a link that is not a Rust checkout, as the image has nothing to build there', () => {
    expect(rustCheckoutsForRun('/checkouts/elmdb', '/checkouts/elmdb', [linked('elmdb'), linked('notes', false)]))
      .toEqual(['/checkouts/elmdb']);
  });
});

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
