// `sortLiteralUnions` is what makes a pack's declaration bundles reproducible, and until this spec existed
// nothing guarded it: the only thing that would have noticed its removal is `npm run check:repro`, which is
// provisional and has no caller. Removing the sort was measured on 2026-09-28 to bring back three distinct
// hashes in four builds of `action-defs.d.ts`, so what is asserted here is the difference between a build
// output that is reproducible and one that is not.
import { describe, expect, it } from 'vitest';
import { sortLiteralUnions } from '../../src/build/declaration-text';

describe('sortLiteralUnions', () => {
  /** The property the whole thing exists for: the same members in any order produce the same text */
  it('gives two orderings of one union the same output', () => {
    const a = sortLiteralUnions('type K = "topic" | "status" | "shortCode";');
    const b = sortLiteralUnions('type K = "status" | "shortCode" | "topic";');
    expect(a).toBe(b);
    // The real pair, from the build that was flapping — tsc emitted both of these for the same sources
    expect(sortLiteralUnions('type T = Omit<X, "topic" | "status">;'))
      .toBe(sortLiteralUnions('type T = Omit<X, "status" | "topic">;'));
  });

  it('sorts the members rather than merely agreeing on some order', () => {
    expect(sortLiteralUnions('type K = "b" | "a" | "c";')).toBe('type K = "a" | "b" | "c";');
  });

  it('handles numeric literals, which tsc reorders the same way', () => {
    expect(sortLiteralUnions('type N = 3 | 1 | 2;')).toBe('type N = 1 | 2 | 3;');
  });

  it('normalizes optional literal unions, including the observed copyState ordering', () => {
    const a = 'type T = { copyState?: "error" | "idle" | "pending" | "saved" | undefined };';
    const b = 'type T = { copyState?: "error" | "pending" | "idle" | "saved" | undefined };';
    expect(sortLiteralUnions(a)).toBe(sortLiteralUnions(b));
    const mixed = 'type T = undefined | "saved" | null | 1;';
    const normalized = sortLiteralUnions(mixed);
    expect(normalized).toBe('type T = "saved" | 1 | null | undefined;');
    expect(sortLiteralUnions(normalized)).toBe(normalized);
  });

  it('preserves comments within unions and leaves non-literal alternatives alone', () => {
    for (const text of [
      'type T = "b" | /* retained explanation */ "a" | undefined;',
      'type T = "b" | // retained explanation\n "a";',
      'type T = Foo | "b" | undefined;',
      'type T = void | "b" | "a";',
    ]) expect(sortLiteralUnions(text)).toBe(text);
    expect(sortLiteralUnions('type T = "https://b" | "https://a" | undefined;'))
      .toBe('type T = "https://a" | "https://b" | undefined;');
  });

  /**
   * Deliberately narrow: type references are left alone. Sorting them would reorder text whose order nothing
   * has measured as varying, and `check:repro` is what would report it if one ever did. If this case ever
   * changes, it should change with a measurement attached.
   */
  it('leaves a union of type references alone', () => {
    expect(sortLiteralUnions('type U = Foo | Bar;')).toBe('type U = Foo | Bar;');
    expect(sortLiteralUnions('type M = "b" | Bar;')).toBe('type M = "b" | Bar;');
  });

  it('sorts a union nested inside a larger declaration, not only a top-level alias', () => {
    expect(sortLiteralUnions('interface I { k: ("b" | "a")[]; nested: { j: "d" | "c" } }'))
      .toBe('interface I { k: ("a" | "b")[]; nested: { j: "c" | "d" } }');
  });

  it('rewrites every union in a file, not just the first', () => {
    expect(sortLiteralUnions('type A = "b" | "a";\ntype B = "d" | "c";'))
      .toBe('type A = "a" | "b";\ntype B = "c" | "d";');
  });

  /** Nothing to do is not an error, and must not corrupt the text it was given */
  it('returns a declaration with no literal union unchanged', () => {
    const untouched = 'export declare function f(x: number): string;\n';
    expect(sortLiteralUnions(untouched)).toBe(untouched);
  });

  /**
   * `createSourceFile` is error-tolerant, so malformed input yields a partial tree rather than a throw. What
   * matters is that it still sorts what it parsed: the alternative — quietly returning the input — would let
   * this look applied while doing nothing, which is the failure mode the bundle had for years.
   */
  it('still sorts the unions it could parse when the rest is malformed', () => {
    expect(sortLiteralUnions('type C = "b" | "a"; function ( {{{ ')).toContain('"a" | "b"');
  });

  /** Sorting an already-sorted bundle changes nothing, which is why the report and the emitter can both run it */
  it('is idempotent, so applying it twice is applying it once', () => {
    const once = sortLiteralUnions('type K = "c" | "a" | "b";');
    expect(sortLiteralUnions(once)).toBe(once);
  });
});
