// What the chain refuses before it runs anything: an install that is not what the checkout pins
// (`scripts/lib/installed-dependencies.ts`). Each case builds the checkout it asks about, since the live one
// happening to be current would make every refusal here pass by saying nothing.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { duplicateCopies, lockfileDrift } from '../../../scripts/lib/installed-dependencies.ts';
import { missingBroker } from '../../../scripts/lib/broker-installed.mjs';
import { missingHoistedOverrides, pruneNestedOverrides } from '../../../scripts/lib/external-packages.mjs';


let dir: string | undefined;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});
const aDir = (prefix: string): string => (dir = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), prefix))));

const entry = (version: string, extra: Record<string, unknown> = {}) => ({
  version,
  resolved: `https://registry.npmjs.org/x/-/x-${version}.tgz`,
  integrity: `sha512-${version}`,
  ...extra,
});

/** A checkout whose lockfile pins `locked` and whose install recorded `installed`, or that has no install at all */
function aCheckout(locked: Record<string, unknown>, installed?: Record<string, unknown>): string {
  const root = aDir('installed-deps-');
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...locked } }));
  if (installed !== undefined) {
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'node_modules', '.package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: installed }));
  }
  return root;
}

describe('one copy of what the app loads once', () => {
  const linked = (target: string) => ({ resolved: target, link: true });

  // Links, as `npm run deps:local` installs a local checkout's packages
  it('says nothing when EARS and elmdb are each one copy, however many links reach it', () => {
    expect(duplicateCopies(aCheckout({}, {
      'node_modules/@elmdb/ears': linked('../elmdb/packages/ears'),
      'packages/server/node_modules/@elmdb/ears': linked('../elmdb/packages/ears'),
      'node_modules/elmdb': linked('../elmdb/crates/elmdb-node'),
      '../elmdb/packages/ears': { version: '0.0.0' },
    }))).toEqual([]);
  });

  // The layout npm writes when a package pins EARS to another range than the SDK's: the lockfile pins both, so only
  // this refusal sees it
  it('refuses a second copy, naming the package, where each is, and the fix', () => {
    const refusals = duplicateCopies(aCheckout({}, {
      'node_modules/@elmdb/ears': linked('../elmdb/packages/ears'),
      'node_modules/@apackdev/testing/node_modules/@elmdb/ears': entry('0.0.1'),
      'node_modules/elmdb': linked('../elmdb/crates/elmdb-node'),
    }));
    expect(refusals).toEqual([expect.stringContaining(
      '@elmdb/ears is installed 2 times (node_modules/@elmdb/ears, node_modules/@apackdev/testing/node_modules/@elmdb/ears)')]);
    expect(refusals[0]).toContain('npm dedupe');
  });

  it('holds for this checkout', () => {
    expect(duplicateCopies(REPO_ROOT)).toEqual([]);
  });
});

describe('node_modules against package-lock.json', () => {
  it('says nothing when npm recorded installing what the lockfile pins', () => {
    const pinned = { 'node_modules/msgpackr': entry('2.1.4'), 'packages/server': { link: true } };
    expect(lockfileDrift(aCheckout(pinned, pinned))).toBeUndefined();
  });

  it('refuses a package installed at another version than the lockfile pins, naming both and `npm ci`', () => {
    const refusal = lockfileDrift(aCheckout({ 'node_modules/msgpackr': entry('2.1.4') }, { 'node_modules/msgpackr': entry('1.11.9') }));
    expect(refusal).toContain('msgpackr 1.11.9 where the lockfile has 2.1.4');
    expect(refusal).toContain('npm ci');
  });

  it('refuses a package the lockfile pins that was never installed, and one installed that it no longer pins', () => {
    const refusal = lockfileDrift(aCheckout(
      { 'node_modules/spdx-satisfies': entry('6.0.0') },
      { 'node_modules/left-behind': entry('1.0.0') },
    ));
    expect(refusal).toContain('1 in the lockfile and not installed: spdx-satisfies');
    expect(refusal).toContain('1 installed and not in the lockfile: left-behind');
  });

  it('does not count an optional package for another platform, which npm leaves out by design', () => {
    const locked = {
      'node_modules/@esbuild/linux-x64': entry('0.25.0', { optional: true }),
      'node_modules/fsevents': entry('2.3.3', { devOptional: true }),
    };
    expect(lockfileDrift(aCheckout(locked, {}))).toBeUndefined();
  });

  it('refuses a checkout with nothing installed', () => {
    expect(lockfileDrift(aCheckout({ 'node_modules/msgpackr': entry('2.1.4') }))).toContain('nothing is installed');
  });
});

describe("the terminal broker's platform package", () => {
  /**
   * A checkout whose `@apackdev/terminal` names `listed` as its platform packages and answers a binary only when
   * `installed`, as the real one answers from its platform package
   */
  function aCheckout(listed: string[], installed: boolean): string {
    const root = aDir('broker-installed-');
    const pkg = path.join(root, 'node_modules', '@apackdev', 'terminal');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({
      name: '@apackdev/terminal', main: 'index.js', optionalDependencies: Object.fromEntries(listed.map((name) => [name, 'https://x.invalid/t.tgz'])),
    }));
    fs.writeFileSync(path.join(pkg, 'index.js'), `module.exports = { PACKAGE_NAME: '@apackdev/terminal-here',
      brokerBinary: () => ${installed ? "'/bin/apack-terminal'" : 'undefined'}, brokerBinaryPath: () => '/bin/apack-terminal' };`);
    return root;
  }

  it('refuses an install the platform package went missing from, naming it', () => {
    const refusal = missingBroker(aCheckout(['@apackdev/terminal-here', '@apackdev/terminal-there'], false));
    expect(refusal).toContain('@apackdev/terminal-here');
    expect(refusal).toContain('npm ci');
  });

  it('says nothing when it is there, or when no package is built for this platform', () => {
    expect(missingBroker(aCheckout(['@apackdev/terminal-here'], true))).toBeUndefined();
    expect(missingBroker(aCheckout(['@apackdev/terminal-there'], false))).toBeUndefined();
  });
});

describe('override switching cleanup and hoisting check', () => {
  it('prunes nested workspace copies and broken symlinks for switched packages while preserving root and unrelated packages', () => {
    const root = aDir('prune-nested-');
    // Root node_modules must stay untouched
    fs.mkdirSync(path.join(root, 'node_modules', '@elmdb', 'ears'), { recursive: true });
    // Workspace A has a scoped directory + unrelated package
    fs.mkdirSync(path.join(root, 'packages', 'apack-host', 'node_modules', '@elmdb', 'ears'), { recursive: true });
    fs.mkdirSync(path.join(root, 'packages', 'apack-host', 'node_modules', 'other-pkg'), { recursive: true });
    // Workspace B has a broken symlink for an unscoped package and a valid symlink for a scoped one
    fs.mkdirSync(path.join(root, 'packages', 'server', 'node_modules', '@elmdb'), { recursive: true });
    fs.symlinkSync(path.join(root, 'does-not-exist'), path.join(root, 'packages', 'server', 'node_modules', 'elmdb'));
    fs.symlinkSync(path.join(root, 'node_modules', '@elmdb', 'ears'), path.join(root, 'packages', 'server', 'node_modules', '@elmdb', 'ears'));

    const removed = pruneNestedOverrides(root, ['elmdb', '@elmdb/ears']).sort();
    expect(removed).toEqual([
      'packages/apack-host/node_modules/@elmdb/ears',
      'packages/server/node_modules/@elmdb/ears',
      'packages/server/node_modules/elmdb',
    ]);
    // Empty @elmdb scope dirs are cleaned up too; unrelated and root packages remain
    expect(fs.existsSync(path.join(root, 'packages', 'apack-host', 'node_modules', '@elmdb'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'packages', 'server', 'node_modules', '@elmdb'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'packages', 'apack-host', 'node_modules', 'other-pkg'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'node_modules', '@elmdb', 'ears'))).toBe(true);
  });

  it('reports packages missing from root node_modules after install', () => {
    const root = aDir('hoisted-check-');
    fs.mkdirSync(path.join(root, 'node_modules', 'elmdb'), { recursive: true });
    expect(missingHoistedOverrides(root, ['elmdb', '@elmdb/ears'])).toEqual(['@elmdb/ears']);
    fs.mkdirSync(path.join(root, 'node_modules', '@elmdb', 'ears'), { recursive: true });
    expect(missingHoistedOverrides(root, ['elmdb', '@elmdb/ears'])).toEqual([]);
  });
});
