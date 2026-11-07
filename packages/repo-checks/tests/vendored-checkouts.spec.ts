// Two pieces of tooling resolved `vendor/elmdb` by name: the janitor's budget, which left a second Rust
// checkout outside it entirely (48 MB from one dependency and one build, with an hourly job reporting
// nothing about it), and the Linux container's image, which built that checkout under elmdb's toolchain
// without saying so. Both derive their subject now, and each case here mutates that subject rather than
// describing it.
import { describe, expect, it } from 'vitest';
import {
  type PinnedToolchain, type VendoredCheckout, oneRustToolchain, rustCheckoutsIn,
} from '../../../scripts/lib/vendored-checkouts.ts';

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
