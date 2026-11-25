import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { buildToolHash } from '../../src/build/tool-identity.ts';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

function tool(source: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-tool-identity-'));
  roots.push(root);
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  write('package.json', JSON.stringify({ name: '@apackdev/cli', version: '1.0.0' }));
  write('bin/apack.mjs', 'import "../dist/cli.js";');
  const entry = source ? 'src/build/tool-identity.ts' : 'dist/shared.js';
  write(entry, 'export const identity = 1;');
  for (const name of source ? ['host', 'pack-format', 'pack-build', 'sdk'] : ['sdk']) {
    write(`node_modules/@apackdev/${name}/package.json`, JSON.stringify({ name: `@apackdev/${name}`, version: '1.0.0',
      ...(source && name === 'sdk' && { dependencies: { '@elmdb/ears': '0.1.0' } }),
      exports: { '.': './entry.js', './package.json': './package.json',
        './build': source ? './entry.js' : './dist/helper.ts', './build/shared-deps': './entry.js' } }));
    write(`node_modules/@apackdev/${name}/entry.js`, 'export {};');
    write(`node_modules/@apackdev/${name}/${source ? 'src' : 'dist'}/helper.ts`, 'export const helper = 1;');
    if (!source) write(`node_modules/@apackdev/${name}/dist/package.json`, JSON.stringify({ name: `@apackdev/${name}` }));
  }
  // EARS, linked from elmdb's checkout as the root's `overrides` links it, which the SDK brings: read by what it ships
  if (source) {
    write('elmdb/packages/ears/package.json', JSON.stringify({ name: '@elmdb/ears', version: '0.1.0', files: ['dist'],
      exports: { '.': './dist/index.js', './package.json': './package.json' } }));
    write('elmdb/packages/ears/dist/index.js', 'export const helper = 1;');
    fs.mkdirSync(path.join(root, 'node_modules/@elmdb'), { recursive: true });
    fs.symlinkSync(path.join(root, 'elmdb/packages/ears'), path.join(root, 'node_modules/@elmdb/ears'), 'dir');
  }
  return { root, write, hash: () => buildToolHash(pathToFileURL(path.join(root, entry)).href) };
}

it.each(['src/commands/generate.ts', 'src/utils.ts', ...['host', 'pack-format', 'pack-build', 'sdk'].map(name => `node_modules/@apackdev/${name}/src/helper.ts`),
  'node_modules/@elmdb/ears/dist/index.js'])(
  'includes workspace helper %s without relying on a version change', file => {
    const scope = tool(true);
    scope.write(file, 'export const helper = 1;');
    const before = scope.hash();
    scope.write(file, 'export const helper = 2;');
    expect(scope.hash()).not.toBe(before);
  },
);

it('hashes every packaged chunk, including added and removed chunks at the same version', () => {
  const scope = tool(false);
  scope.write('dist/chunks/generate.js', 'before');
  const before = scope.hash();
  scope.write('dist/chunks/generate.js', 'after');
  expect(scope.hash()).not.toBe(before);
  scope.write('dist/chunks/generate.js', 'before');
  expect(scope.hash()).toBe(before);
  scope.write('dist/chunks/new.js', 'added');
  expect(scope.hash()).not.toBe(before);
  fs.rmSync(path.join(scope.root, 'dist/chunks/new.js'));
  expect(scope.hash()).toBe(before);
  fs.rmSync(path.join(scope.root, 'dist/chunks/generate.js'));
  expect(scope.hash()).not.toBe(before);
});

it('is independent of installation paths and timestamps', () => {
  const first = tool(true), second = tool(true);
  fs.utimesSync(path.join(second.root, 'src/build/tool-identity.ts'), new Date(), new Date(Date.now() + 60_000));
  expect(first.hash()).toBe(second.hash());
});

it.each(['missing', 'empty'])('refuses %s implementation evidence rather than using a version', kind => {
  const scope = tool(true);
  const directory = path.join(scope.root, 'node_modules/@apackdev/host/src');
  fs.rmSync(directory, { recursive: true });
  if (kind === 'empty') fs.mkdirSync(directory);
  expect(scope.hash).toThrow('Missing build tool implementation: @apackdev/host/src');
});

it('does not require inlined packages beside a published CLI', () => {
  const scope = tool(false);
  expect(scope.hash()).toMatch(/^[a-f0-9]{64}$/);
});

it('preserves installed SDK declaration coverage beside the packaged generator', () => {
  const scope = tool(false);
  const before = scope.hash();
  scope.write('node_modules/@apackdev/sdk/dist/helper.ts', 'export const helper = 2;');
  expect(scope.hash()).not.toBe(before);
});

it('reads installed SDK packages whose compiled files live at the package root', () => {
  const scope = tool(false);
  const sdk = path.join(scope.root, 'node_modules/@apackdev/sdk');
  fs.renameSync(path.join(sdk, 'dist/helper.ts'), path.join(sdk, 'helper.ts'));
  fs.rmSync(path.join(sdk, 'dist'), { recursive: true });
  scope.write('node_modules/@apackdev/sdk/package.json', JSON.stringify({ name: '@apackdev/sdk',
    exports: { './package.json': './package.json', './build': './helper.ts' } }));
  const before = scope.hash();
  scope.write('node_modules/@apackdev/sdk/helper.ts', 'export const helper = 2;');
  expect(scope.hash()).not.toBe(before);
});

it('uses workspace ownership even when a resolved SDK output contains nested package metadata', () => {
  const scope = tool(true);
  scope.write('node_modules/@apackdev/sdk/dist/package.json', JSON.stringify({ name: '@apackdev/sdk' }));
  scope.write('node_modules/@apackdev/sdk/dist/helper.js', 'export {};');
  scope.write('node_modules/@apackdev/sdk/package.json', JSON.stringify({ name: '@apackdev/sdk', dependencies: { '@elmdb/ears': '0.1.0' },
    exports: { './package.json': './package.json', './build': './dist/helper.js' } }));
  const before = scope.hash();
  scope.write('node_modules/@apackdev/sdk/src/helper.ts', 'export const helper = 2;');
  expect(scope.hash()).not.toBe(before);
});

it("reads EARS by what it ships, so a file of its checkout that isn't shipped is not the tool", () => {
  const scope = tool(true);
  const before = scope.hash();
  scope.write('node_modules/@elmdb/ears/src/index.ts', 'export const helper = 2;');
  expect(scope.hash()).toBe(before);
});

it("refuses an SDK whose EARS doesn't resolve rather than leave it out", () => {
  const scope = tool(true);
  fs.rmSync(path.join(scope.root, 'node_modules/@elmdb'), { recursive: true });
  expect(scope.hash).toThrow(/@elmdb\/ears, declared by @apackdev\/sdk/);
});

it("leaves what the SDK has from the registry to the lockfile: a file of one isn't the tool", () => {
  const scope = tool(true);
  scope.write('node_modules/@apackdev/sdk/package.json', JSON.stringify({ name: '@apackdev/sdk', version: '1.0.0',
    dependencies: { '@elmdb/ears': '0.1.0', yaml: '^2.0.0' },
    exports: { '.': './entry.js', './package.json': './package.json', './build': './entry.js' } }));
  scope.write('node_modules/yaml/package.json', JSON.stringify({ name: 'yaml', version: '2.0.0' }));
  scope.write('node_modules/yaml/index.js', 'export const helper = 1;');
  const before = scope.hash();
  scope.write('node_modules/yaml/index.js', 'export const helper = 2;');
  expect(scope.hash()).toBe(before);
  scope.write('node_modules/@elmdb/ears/dist/index.js', 'export const helper = 2;');
  expect(scope.hash()).not.toBe(before);
});
