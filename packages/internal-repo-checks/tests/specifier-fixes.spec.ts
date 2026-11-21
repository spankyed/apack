import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyFixes, spliceFile, type Fix } from '../../../scripts/lib/specifier-fixes.ts';

/**
 * `npm run specifiers:fix` writes what the rules already computed. What makes a rewriter safe is not the
 * writing but the refusals, so those are the cases: a span that no longer holds what the reader saw, two spans
 * that overlap, and a file it has no business opening.
 */
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'specifier-fixes-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const write = (file: string, text: string): string => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
  return text;
};
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf-8');

/** The fix a rule would report for the nth quoted specifier in `text` */
const fixFor = (file: string, text: string, specifier: string, named: string, from = 0): Fix => {
  const start = text.indexOf(specifier, from);
  return { file, line: text.slice(0, start).split('\n').length, start, end: start + specifier.length, specifier, named };
};

describe('spliceFile', () => {
  it('replaces right to left, so three spans on one line all land', () => {
    const text = "import './a.js'; import './b.js'; import './c.js';";
    const fixes = ['./a.js', './b.js', './c.js'].map((specifier) =>
      fixFor('f.ts', text, specifier, specifier.replace('.js', '.ts')));
    expect(spliceFile(text, fixes)).toEqual({ text: "import './a.ts'; import './b.ts'; import './c.ts';" });
  });

  /** The reader and the disk disagreeing makes every offset suspect, not just this one */
  it('refuses the whole file when a span does not hold the specifier it was told about', () => {
    const text = "import './a.ts';";
    expect(spliceFile(text, [{ start: 8, end: 14, specifier: './b.js', named: './b.ts' }]))
      .toEqual({ refused: expect.stringContaining('the file changed since it was read') as unknown as string });
  });

  it('refuses two findings that overlap', () => {
    const text = "import './a.js';";
    expect(spliceFile(text, [
      { start: 8, end: 14, specifier: './a.js', named: './a.ts' },
      { start: 10, end: 15, specifier: 'a.js\'', named: 'x' },
    ])).toEqual({ refused: expect.stringContaining('overlap') as unknown as string });
  });

  it('refuses a file with nothing to do rather than rewriting identical bytes', () => {
    expect(spliceFile('export const x = 1;', [])).toEqual({ refused: 'nothing to fix in this file' });
  });
});

describe('applyFixes', () => {
  it('writes each file once, however many fixes it holds', () => {
    const text = write('src/f.ts', "import './a.js';\nimport './b.js';\n");
    write('src/clean.ts', 'export const x = 1;\n');
    const writes: string[] = [];
    const { written, refused } = applyFixes(root, [
      fixFor('src/f.ts', text, './a.js', './a.ts'),
      fixFor('src/f.ts', text, './b.js', './b.ts'),
    ], (file, next) => { writes.push(file); fs.writeFileSync(file, next); });
    expect(writes).toHaveLength(1);
    expect(written).toEqual([{ file: 'src/f.ts', count: 2 }]);
    expect(refused).toEqual([]);
    expect(read('src/f.ts')).toBe("import './a.ts';\nimport './b.ts';\n");
  });

  it('leaves a file it was given no fix for exactly as it was', () => {
    const before = write('src/clean.ts', "import './a.ts';\n");
    applyFixes(root, []);
    expect(read('src/clean.ts')).toBe(before);
  });

  it('reports a refused file and writes the others', () => {
    const good = write('src/good.ts', "import './a.js';\n");
    const stale = write('src/stale.ts', "import './b.ts';\n");
    const { written, refused } = applyFixes(root, [
      fixFor('src/good.ts', good, './a.js', './a.ts'),
      { file: 'src/stale.ts', line: 1, start: 8, end: 14, specifier: './b.js', named: './b.ts' },
    ]);
    expect(written).toEqual([{ file: 'src/good.ts', count: 1 }]);
    expect(refused.map(({ file }) => file)).toEqual(['src/stale.ts']);
    expect(read('src/stale.ts')).toBe(stale);
  });

  /** Applying twice writes nothing the second time, which is what says one pass per file is enough */
  it('is idempotent: the second run has nothing to fix', () => {
    const text = write('src/f.ts', "import './a.js';\n");
    applyFixes(root, [fixFor('src/f.ts', text, './a.js', './a.ts')]);
    const after = read('src/f.ts');
    const { written, refused } = applyFixes(root, [fixFor('src/f.ts', after, './a.js', './a.ts')]);
    expect(written).toEqual([]);
    expect(refused).toHaveLength(1);
    expect(read('src/f.ts')).toBe(after);
  });
});
