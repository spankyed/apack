// The unit test setup `apack pack add feature` gives a pack without one: it keeps any config vitest already loads, and
// adds or checks @apackdev/testing and vitest against what the harness runs on
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scaffoldUnitTestSetup } from '../../src/commands/init';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function pack(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-unit-setup-'));
  dirs.push(root);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

const packageJson = (fields: object) => JSON.stringify({ name: 'old-pack', type: 'module', ...fields });
const readPackageJson = (root: string) => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

describe('scaffoldUnitTestSetup', () => {
  it.each(['vitest.config.mts', 'vitest.config.js', 'vite.config.ts', 'vite.config.cjs'])('keeps the %s vitest loads', (config) => {
    const root = pack({ [config]: 'export default {};', 'package.json': packageJson({}) });

    const setup = scaffoldUnitTestSetup(root);

    expect(setup.keptConfig).toBe(config);
    expect(fs.existsSync(path.join(root, 'vitest.config.ts'))).toBe(false);
    expect(setup.created).toEqual([path.join(root, 'tests', 'setup.ts')]);
  });

  it('writes vitest.config.ts when vitest has no config to load', () => {
    const root = pack({ 'package.json': packageJson({}) });

    const setup = scaffoldUnitTestSetup(root);

    expect(setup.keptConfig).toBeUndefined();
    expect(setup.created).toContain(path.join(root, 'vitest.config.ts'));
  });

  it("adds @apackdev/testing at the pack's own @apackdev/sdk range, which its peer dependency matches", () => {
    const root = pack({ 'package.json': packageJson({ dependencies: { '@apackdev/sdk': '^0.0.7' } }) });

    const setup = scaffoldUnitTestSetup(root);

    expect(setup.addedDependencies).toEqual(['@apackdev/testing', 'vitest']);
    expect(setup.upgrades).toEqual([]);
    expect(readPackageJson(root).devDependencies).toEqual({ '@apackdev/testing': '^0.0.7', vitest: '^4.1.12' });
  });

  it('names the upgrade for an installed @apackdev/testing without the harness and a vitest before 3, keeping them', () => {
    const root = pack({
      'package.json': packageJson({ dependencies: { '@apackdev/sdk': '^0.0.7' }, devDependencies: { '@apackdev/testing': '^0.0.7', vitest: '^2.1.0' } }),
      'node_modules/@apackdev/testing/package.json': JSON.stringify({ name: '@apackdev/testing', version: '0.0.7', exports: { '.': './dist/index.js' } }),
    });

    const setup = scaffoldUnitTestSetup(root);

    expect(setup.addedDependencies).toEqual([]);
    expect(setup.upgrades).toEqual([
      { name: '@apackdev/testing', range: '^0.0.7', reason: 'the installed 0.0.7 has no @apackdev/testing/harness' },
      { name: 'vitest', range: '^4.1.12', reason: '^2.1.0 is before 3.0.0' },
    ]);
    expect(readPackageJson(root).devDependencies).toEqual({ '@apackdev/testing': '^0.0.7', vitest: '^2.1.0' });
  });

  it("names the upgrade for an @apackdev/testing range that doesn't match the pack's @apackdev/sdk", () => {
    const root = pack({ 'package.json': packageJson({ dependencies: { '@apackdev/sdk': '^0.1.0' }, devDependencies: { '@apackdev/testing': '^0.2.0', vitest: '^3.2.4' } }) });

    expect(scaffoldUnitTestSetup(root).upgrades).toEqual([
      { name: '@apackdev/testing', range: '^0.1.0', reason: "^0.2.0 doesn't match the pack's @apackdev/sdk ^0.1.0" },
    ]);
  });

  it('checks the installed vitest when the declared range allows 3', () => {
    const root = pack({
      'package.json': packageJson({ devDependencies: { '@apackdev/testing': '*', vitest: '*' } }),
      'node_modules/@apackdev/testing/package.json': JSON.stringify({ name: '@apackdev/testing', version: '0.1.0', exports: { './harness': './dist/harness.js' } }),
      'node_modules/vitest/package.json': JSON.stringify({ name: 'vitest', version: '2.1.9' }),
    });

    expect(scaffoldUnitTestSetup(root).upgrades).toEqual([
      { name: 'vitest', range: '^4.1.12', reason: 'the installed 2.1.9 is before 3.0.0' },
    ]);
  });
});
