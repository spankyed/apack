// A pack compiles and runs against the @apackdev packages' dist. When that dist belongs to a checkout it is
// built on demand, so the commands that load it (apack pack test, apack pack dev) ask the checkout to refresh it.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkoutBuildUnits, checkoutFor, ensureCheckoutPackages } from '../../src/build/checkout-packages';
import { BUILD_UNITS, CHECKOUT_MARKER, REPO_ROOT } from '@apackdev/host/build/packages-built';

const tmpDirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

it('scopes a selected compiler binary to the pack rather than checkout setup', () => {
  const dir = pack('none');
  const checkout = path.join(dir, 'checkout');
  const sdk = path.join(checkout, 'packages/sdk');
  fs.mkdirSync(sdk, { recursive: true });
  fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: '@apackdev/sdk' }));
  fs.mkdirSync(path.dirname(path.join(checkout, CHECKOUT_MARKER)), { recursive: true });
  fs.writeFileSync(path.join(checkout, CHECKOUT_MARKER), '');
  fs.writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({ scripts: {
    'packages:ensure': `node -e "require('node:fs').writeFileSync('environment.json', JSON.stringify({binary:process.env.ESBUILD_BINARY_PATH, marker:process.env.APACK_TEST_BOOTSTRAP_MARKER}))"`,
  } }));
  const modules = path.join(dir, 'node_modules/@apackdev');
  fs.mkdirSync(modules, { recursive: true });
  fs.symlinkSync(sdk, path.join(modules, 'sdk'), 'dir');
  vi.stubEnv('ESBUILD_BINARY_PATH', 'selected-pack-binary');
  vi.stubEnv('APACK_TEST_BOOTSTRAP_MARKER', 'preserved');
  ensureCheckoutPackages(dir, 'pipe');
  expect(JSON.parse(fs.readFileSync(path.join(checkout, 'environment.json'), 'utf8'))).toEqual({ marker: 'preserved' });
  expect(process.env.ESBUILD_BINARY_PATH).toBe('selected-pack-binary');
});

function pack(link: 'checkout' | 'installed' | 'none'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-checkout-for-'));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'link-pack', type: 'module' }));
  const modules = path.join(dir, 'node_modules', '@apackdev');
  if (link === 'checkout') {
    fs.mkdirSync(modules, { recursive: true });
    fs.symlinkSync(path.join(REPO_ROOT, 'packages', 'apack-sdk'), path.join(modules, 'sdk'), 'dir');
  } else if (link === 'installed') {
    // What npm delivers: a real directory under node_modules, with no checkout above it
    fs.mkdirSync(path.join(modules, 'sdk'), { recursive: true });
    fs.writeFileSync(path.join(modules, 'sdk', 'package.json'), JSON.stringify({
      name: '@apackdev/sdk', version: '0.1.0', exports: { './package.json': './package.json' },
    }));
  }
  return dir;
}

describe('the checkout a pack\'s @apackdev packages come from', () => {
  it('is the apack checkout when the packages are linked to one', () => {
    expect(checkoutFor(pack('checkout'))).toBe(REPO_ROOT);
  });

  it('is nothing when the packages are installed, so a command has nothing to build', () => {
    expect(checkoutFor(pack('installed'))).toBeUndefined();
  });

  it('is nothing when the pack has no @apackdev/sdk at all', () => {
    expect(checkoutFor(pack('none'))).toBeUndefined();
  });

  it('gives a linked pack its checkout\'s build units once, however many directories lead there', () => {
    const units = checkoutBuildUnits([pack('checkout'), pack('checkout')]);
    expect(units).toHaveLength(Object.keys(BUILD_UNITS).length);
    expect(units.flatMap(unit => unit.inputs)).toEqual(expect.arrayContaining(Object.values(BUILD_UNITS).flatMap(unit => unit.inputs)));
  });

  it('gives an installed pack no build units, so its watcher subscribes to nothing extra', () => {
    expect(checkoutBuildUnits([pack('installed'), pack('none')])).toEqual([]);
  });
});

/**
 * Test orchestration refreshes directly; builds refresh through the shared builder before capturing
 * a compiler. pack-builder.native.spec.ts exercises that ordering with a real captured worker.
 */
describe('the commands that refresh a checkout before loading its packages', () => {
  const source = (file: string) => fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'src', file), 'utf-8');

  it('refreshes the test command’s checkout', () => {
    expect(source('commands/test.ts')).toContain('ensureCheckoutPackages(');
  });

  it('dispatches apack pack build to the command that refreshes, not to the bare build', () => {
    expect(source('command-tree.ts')).toContain("load: async () => (await import('./commands/build')).buildCommand");
  });

  // npm run dev declares no packages:ensure of its own: it reaches the check by building the built-in pack
  // with `apack pack build`. Nothing else holds that link, so a build:dev that stopped being an apack pack build
  // would drop npm run dev's only door without failing anything.
  it('leaves npm run dev reaching the check through apack pack build, its only door on that path', () => {
    const script = (pkg: string, name: string): string =>
      JSON.parse(fs.readFileSync(path.join(REPO_ROOT, pkg, 'package.json'), 'utf-8')).scripts[name] ?? '';

    const launcher = fs.readFileSync(path.join(REPO_ROOT, 'packages/dev-mode.js'), 'utf-8');
    expect(launcher).toContain("['run', 'build:dev', '-w', '@app/default-setup']");
    expect(launcher, 'npm run dev reaches packages:ensure through apack pack build')
      .not.toContain('packages:ensure');
    expect(script('packages/default-setup', 'build:dev')).toMatch(/^apack pack build\b/);
  });
});

describe('the checkout a pack\'s @apackdev packages come from', () => {
  // Asking only the SDK would miss this: the linked package's dist is built on demand and would be used
  // stale, with nothing saying so
  it('is the checkout when any one package is linked to it, not only @apackdev/sdk', () => {
    const dir = pack('installed');
    const modules = path.join(dir, 'node_modules', '@apackdev');
    fs.symlinkSync(path.join(REPO_ROOT, 'packages', 'apack-ui'), path.join(modules, 'ui'), 'dir');
    expect(checkoutFor(dir)).toBe(REPO_ROOT);
  });
});
