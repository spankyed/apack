// Reading the runners' own output back. The value of this is that it needs no reporter, no JSON file and no
// flag — so it keeps working when `test:unit` becomes one root vitest run. The risk is the same: it is a
// parser over someone else's format, so the shapes it must handle are pinned here.
import { describe, expect, it } from 'vitest';
import { slowestTests } from '../../../scripts/lib/slow-tests.ts';

const line = (indent: number, mark: string, name: string, ms: number) => `${' '.repeat(indent)}${mark} ${name}  ${ms}ms`;

describe('slowestTests', () => {
  it('reads the indented per-test lines vitest prints past its slow threshold', () => {
    const output = [
      ' ✓ tests/unit/a.spec.ts (12 tests) 900ms',
      line(3, '✓', 'a suite > a slow case', 420),
      line(3, '✓', 'a suite > a slower case', 830),
    ].join('\n');
    expect(slowestTests(output)).toEqual([
      { name: 'a suite > a slower case', ms: 830 },
      { name: 'a suite > a slow case', ms: 420 },
    ]);
  });

  // A file's own line carries the whole file's time and would otherwise dominate every list
  it('ignores the file lines, which are a total and not a test', () => {
    expect(slowestTests(' ✓ tests/unit/a.spec.ts (12 tests) 9000ms')).toEqual([]);
    expect(slowestTests('   ✓ tests/unit/a.spec.ts (1 test) 9000ms')).toEqual([]);
  });

  it('sees through the colours the runners write', () => {
    const coloured = `   \u001B[32m✓\u001B[39m a suite > a case  \u001B[2m512ms\u001B[22m`;
    expect(slowestTests(coloured)).toEqual([{ name: 'a suite > a case', ms: 512 }]);
  });

  it('includes a failing test, which is often the slow one', () => {
    expect(slowestTests(line(3, '×', 'a suite > the hang', 15000))).toEqual([{ name: 'a suite > the hang', ms: 15000 }]);
  });

  it('takes the slowest five by default, and however many are asked for', () => {
    const output = [9, 1, 7, 3, 5, 8, 2].map((n) => line(3, '✓', `case ${n}`, n * 100)).join('\n');
    expect(slowestTests(output).map((t) => t.ms)).toEqual([900, 800, 700, 500, 300]);
    expect(slowestTests(output, 2).map((t) => t.ms)).toEqual([900, 800]);
  });

  it('finds nothing in output that reported no slow test', () => {
    expect(slowestTests('')).toEqual([]);
    expect(slowestTests('Test Files  33 passed (33)\n     Tests  307 passed (307)')).toEqual([]);
  });
});
