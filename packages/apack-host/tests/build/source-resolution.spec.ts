import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { assertSourceResolution, formatNodeOptions, parseNodeOptions, SOURCE_CONDITION, withoutSourceCondition, type ResolveFile } from '../../src/build/source-resolution.ts';

const MANIFEST = {
  name: '@apackdev/sdk',
  type: 'module',
  exports: {
    './package.json': './package.json',
    '.': { '@apackdev/source': './src/index.ts', default: './dist/index.js' },
  },
};

let root: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-source-resolution-')));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** A checkout whose workspace @apackdev/sdk is linked into node_modules, as npm workspaces do */
function checkout({ built }: { built: boolean }): string {
  const dir = path.join(root, 'checkout');
  const sdk = path.join(dir, 'packages', 'apack-sdk');
  write(path.join(sdk, 'package.json'), JSON.stringify(MANIFEST));
  write(path.join(sdk, 'src', 'index.ts'), 'export {};');
  if (built) write(path.join(sdk, 'dist', 'index.js'), 'export {};');
  fs.mkdirSync(path.join(dir, 'node_modules', '@apackdev'), { recursive: true });
  fs.symlinkSync(sdk, path.join(dir, 'node_modules', '@apackdev', 'sdk'), 'dir');
  return dir;
}

/** Resolves from `cwd` in a plain Node process, with or without the source condition */
function nodeResolver(cwd: string, conditions: string[] = []): ResolveFile {
  return (specifier) => execFileSync(
    process.execPath,
    [...conditions.map((c) => `--conditions=${c}`), '-p', `require.resolve(${JSON.stringify(specifier)})`],
    { cwd, env: { PATH: process.env.PATH }, stdio: 'pipe' },
  ).toString().trim();
}

describe('assertSourceResolution', () => {
  it('throws when a checkout resolves to its built dist', () => {
    const dir = checkout({ built: true });
    expect(() => assertSourceResolution(nodeResolver(dir), 'The test process'))
      .toThrow(/The test process resolves @apackdev\/sdk to dist\/index\.js instead of the checkout's source/);
  });

  it('throws when a checkout has no dist and no condition', () => {
    const dir = checkout({ built: false });
    expect(() => assertSourceResolution(nodeResolver(dir), 'The test process')).toThrow(/to its unbuilt dist/);
  });


  it('passes when the process has the source condition', () => {
    const dir = checkout({ built: true });
    expect(() => assertSourceResolution(nodeResolver(dir, ['@apackdev/source']), 'The test process')).not.toThrow();
  });

  it('passes for an installed package, which ships no src', () => {
    const dir = path.join(root, 'pack');
    const sdk = path.join(dir, 'node_modules', '@apackdev', 'sdk');
    write(path.join(sdk, 'package.json'), JSON.stringify(MANIFEST));
    write(path.join(sdk, 'dist', 'index.js'), 'export {};');
    expect(() => assertSourceResolution(nodeResolver(dir), 'The test process')).not.toThrow();
  });

  it('passes when the packages are not installed', () => {
    const dir = path.join(root, 'empty');
    fs.mkdirSync(dir);
    expect(() => assertSourceResolution(nodeResolver(dir), 'The test process')).not.toThrow();
  });
});


describe('Node launch options', () => {
  it('uses Node quoting and escaping rather than shell rules', () => {
    expect(parseNodeOptions('--conditions="two  spaces" --conditions=\'single quote\'')).toEqual([
      '--conditions=two  spaces', "--conditions='single", "quote'",
    ]);
    const args = ['--require', String.raw`C:\two  spaces\a"b.cjs`, '--conditions=with\ttab'];
    expect(parseNodeOptions(formatNodeOptions(args))).toEqual(args);
    expect(parseNodeOptions('"" --conditions=value')).toEqual(['--conditions=value']);
    expect(() => parseNodeOptions('--require "unfinished')).toThrow('unterminated string');
    expect(() => parseNodeOptions('"trailing' + String.fromCharCode(92))).toThrow('invalid escape');
  });

  it.each(['--conditions', '-C', '--conditions=', '-C='])('removes %s source selectors while preserving native preload execution', async flag => {
    const dir = checkout({ built: true });
    const preload = path.join(root, 'pre load  file.cjs');
    write(preload, 'globalThis.preloadProbe = "PRELOADED";');
    const source = flag.endsWith('=') ? [flag + SOURCE_CONDITION] : [flag, SOURCE_CONDITION];
    const options = formatNodeOptions(['--require', preload, ...source, '--conditions=other  selector']);
    const { stdout } = await execFileWhileWorking(process.execPath, ['-p', 'JSON.stringify([globalThis.preloadProbe, require.resolve("@apackdev/sdk")])'], {
      cwd: dir, env: { PATH: process.env.PATH, NODE_OPTIONS: withoutSourceCondition(options) },
    });
    expect(JSON.parse(stdout)).toEqual(['PRELOADED', path.join(dir, 'packages/apack-sdk/dist/index.js')]);
  });
});
