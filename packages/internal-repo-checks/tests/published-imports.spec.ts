// What gets published in a package's declarations: the relative specifiers rewritten to `.js`, and the
// packages those declarations pull in, which the manifest has to declare.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BareImports, rewriteDeclarationExtensions } from '../../../scripts/lib/published-imports.ts';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'published-declarations-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function rewrite(contents: string): string {
  fs.writeFileSync(path.join(dir, 'index.d.ts'), contents);
  rewriteDeclarationExtensions(dir);
  return fs.readFileSync(path.join(dir, 'index.d.ts'), 'utf-8');
}

describe('rewriteDeclarationExtensions', () => {
  it('rewrites the import forms declarations actually use', () => {
    const after = rewrite([
      "import './side.ts';",
      "import type { A } from './a.ts';",
      "export { B } from './b.ts';",
      "export * from './c.ts';",
      "declare module './aug.ts' { }",
      "import eq = require('./eq.ts');",
      "type D = import('./dyn.ts').D;",
      'export {};',
    ].join('\n'));
    expect(after).not.toMatch(/\.ts'/);
    for (const name of ['side', 'a', 'b', 'c', 'aug', 'eq', 'dyn']) {
      expect(after).toContain(`'./${name}.js'`);
    }
  });

  // A regex over the text reads this as an import. The scanner knows it is a comment.
  it('leaves a specifier inside a doc comment alone', () => {
    const after = rewrite("/** @example import './doc.ts'; */\nexport {};\n");
    expect(after).toContain("import './doc.ts';");
  });

  // `.vue` resolves to the `button.d.vue.ts` beside it, and a bare package specifier is not ours to move
  it('touches neither .vue specifiers nor package specifiers', () => {
    const source = "import Button from './button.vue';\nimport type { X } from 'some-pkg/sub.ts';\nexport {};\n";
    expect(rewrite(source)).toBe(source);
  });

  it('rewrites every specifier on one line, whatever order the scanner reports them in', () => {
    const after = rewrite("export { a } from './aaa.ts';\nexport { b } from './b.ts';\nimport './ccccc.ts';\nexport {};\n");
    expect(after).toContain("'./aaa.js'");
    expect(after).toContain("'./b.js'");
    expect(after).toContain("'./ccccc.js'");
  });
});

describe('BareImports.fromDeclaration', () => {
  const namesOf = (contents: string) => {
    const imports = new BareImports(dir);
    imports.fromDeclaration(contents, path.join(dir, 'index.d.ts'));
    return [...(imports as unknown as { imports: Map<string, Set<string>> }).imports.keys()].sort();
  };

  // `/// <reference types="x" />` pulls in x's declarations as surely as an import does
  it('counts a type reference directive as a dependency', () => {
    expect(namesOf('/// <reference types="some-pkg" />\nexport {};\n')).toEqual(['some-pkg']);
  });

  it('does not count a lib reference, which names no package', () => {
    expect(namesOf('/// <reference lib="dom" />\nexport {};\n')).toEqual([]);
  });

  it('skips relative and subpath-imports specifiers', () => {
    expect(namesOf("import './a.ts';\nimport '#internal';\nimport 'pkg';\nexport {};\n")).toEqual(['pkg']);
  });
});
