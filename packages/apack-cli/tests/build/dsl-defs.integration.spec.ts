import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBuildOutputs } from '../../src/build/build-outputs.ts';
import { bundleDslDefs, monacoDefsFile, withoutRenameSuffixes } from '../../src/build/dsl-defs';
import type { PackManifest } from '@apackdev/pack-format';

/**
 * The DSL editors load the declarations `apack pack build` writes, with no node_modules behind them: a
 * package import left in a definitions file is a type the editor silently can't resolve.
 */
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-defs-'));
  // The pack resolves @apackdev/* as an installed pack does
  fs.mkdirSync(path.join(dir, 'node_modules', '@apackdev'), { recursive: true });
  fs.symlinkSync(path.resolve(__dirname, '..', '..', '..', 'apack-sdk'), path.join(dir, 'node_modules', '@apackdev', 'sdk'));
  write('tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'esnext', moduleResolution: 'bundler', strict: true, skipLibCheck: true, noEmit: true,
      customConditions: ['@apackdev/source'], allowImportingTsExtensions: true,
    },
    include: ['src/**/*.ts'],
  }));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
}

function manifest(entry: Record<string, unknown>): PackManifest {
  return { id: 'defs-pack', name: 'Defs Pack', version: '1.0.0', extensions: { dsl: { console: { entry: 'src/defs/console.ts', targets: ['monaco'], ...entry } } } } as PackManifest;
}

const defs = () => fs.readFileSync(path.join(dir, '.apack', 'build', monacoDefsFile('console')), 'utf-8');

describe('bundleDslDefs', () => {
  it("inlines the pack's own modules and the SDK, and wraps them as the editor's module", async () => {
    write('src/local.ts', 'export interface Row { id: string }\n');
    write('src/defs/console.ts', [
      "export type { Row } from '../local.ts';",
      "export type { ArtifactItem } from '@apackdev/sdk/artifacts';",
    ].join('\n'));

    write('dist/defs/monaco/console-defs.d.ts', 'accepted published definitions');
    const outputs = createBuildOutputs(path.join(dir, '.apack', 'build'));
    const result = await bundleDslDefs(dir, path.join(dir, '.apack', 'build'), manifest({}), { recordOutput: outputs.record });
    expect(() => outputs.assertCurrent()).not.toThrow();
    expect(fs.readFileSync(path.join(dir, 'dist/defs/monaco/console-defs.d.ts'), 'utf8')).toBe('accepted published definitions');

    expect(result).toEqual({ success: true, files: [monacoDefsFile('console')] });
    expect(defs()).toMatch(/^declare module "@app\/defs\/console" \{/);
    expect(defs().trimEnd()).toMatch(/\}$/);
    expect(defs()).toMatch(/interface Row \{/);
    expect(defs()).toMatch(/interface ArtifactItem</);
    expect(defs()).not.toMatch(/from '@apackdev\//);
    fs.appendFileSync(path.join(dir, '.apack', 'build', monacoDefsFile('console')), '// changed');
    expect(() => outputs.assertCurrent()).toThrow(/missing or changed/);
  });

  it('leaves other packages imports until the entry inlines them', async () => {
    write('src/defs/console.ts', "export type { Nested } from 'nested-dep';\n");
    write('node_modules/nested-dep/package.json', JSON.stringify({ name: 'nested-dep', version: '1.0.0', types: 'index.d.ts' }));
    write('node_modules/nested-dep/index.d.ts', 'export interface Nested { deep: true }\n');

    await bundleDslDefs(dir, path.join(dir, '.apack', 'build'), manifest({}));
    expect(defs()).toMatch(/from 'nested-dep'/);

    await bundleDslDefs(dir, path.join(dir, '.apack', 'build'), manifest({ inline: ['nested-dep'] }));
    expect(defs()).toMatch(/interface Nested \{/);
    expect(defs()).not.toMatch(/from 'nested-dep'/);
  });

  it('reports which DSL entry failed to bundle', async () => {
    write('src/defs/console.ts', "export type { Missing } from './gone.ts';\n");
    const result = await bundleDslDefs(dir, path.join(dir, '.apack', 'build'), manifest({}));
    expect(result).toEqual({ success: false, error: expect.stringMatching(/^console: /) });
  });

  it('writes nothing for an entry no editor targets', async () => {
    write('src/defs/console.ts', 'export interface Row { id: string }\n');
    const result = await bundleDslDefs(dir, path.join(dir, '.apack', 'build'), { ...manifest({}), extensions: { dsl: { console: { entry: 'src/defs/console.ts', targets: [] } } } } as PackManifest);
    expect(result).toEqual({ success: true, files: [] });
    expect(fs.existsSync(path.join(dir, '.apack', 'build', monacoDefsFile('console')))).toBe(false);
  });
});

describe('withoutRenameSuffixes', () => {
  it("drops a suffix rollup added for a name only a global takes", () => {
    expect(withoutRenameSuffixes('interface Node$1 { id: string }\ndeclare const root: Node$1;\nexport { Node$1 as Node };\n'))
      .toBe('interface Node { id: string }\ndeclare const root: Node;\nexport { Node as Node };\n');
  });

  it('keeps the suffixes of a name two declarations share, so they stay apart', () => {
    const code = [
      "declare namespace EARS { const Entity: { readonly Relation: 'Relation' }; }",
      "declare namespace EARS$1 { const Entity: { readonly Flow: 'Flow' }; }",
      'declare const flow: typeof EARS$1.Entity.Flow;',
      'export { EARS$1 as EARS, flow };',
      '',
    ].join('\n');
    expect(withoutRenameSuffixes(code)).toBe(code);
  });
});
