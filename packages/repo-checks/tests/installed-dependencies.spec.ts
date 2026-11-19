// What the chain refuses before it runs anything: an install that is not what the checkout pins
// (`scripts/lib/installed-dependencies.ts`). Each case builds the checkout it asks about, since the live one
// happening to be current would make every refusal here pass by saying nothing.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { brokerDrift, lockfileDrift } from '../../../scripts/lib/installed-dependencies.ts';

const PLATFORM = `${process.platform}-${process.arch}`;
const COMMIT = 'c'.repeat(40);

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

describe('node_modules against package-lock.json', () => {
  it('says nothing when npm recorded installing what the lockfile pins', () => {
    const pinned = { 'node_modules/msgpackr': entry('2.1.4'), 'packages/api': { link: true } };
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

describe('the terminal broker against its pin', () => {
  /** A copy of `@app/terminal-broker` with a pin naming `files` for `platform`, and the files of `installed` in `bin/` */
  function aBrokerPackage(platform: string, installed: boolean): string {
    const pkg = aDir('broker-pin-');
    fs.mkdirSync(path.join(pkg, 'src'));
    fs.copyFileSync(path.join(REPO_ROOT, 'packages', 'terminal-broker', 'src', 'index.js'), path.join(pkg, 'src', 'index.js'));
    const binary = process.platform === 'win32' ? 'apack-terminal.exe' : 'apack-terminal';
    fs.writeFileSync(path.join(pkg, 'src', 'pin.json'), JSON.stringify({ commit: COMMIT, files: { [platform]: { [binary]: 'f'.repeat(64) } } }));
    if (installed) {
      fs.mkdirSync(path.join(pkg, 'bin', COMMIT, platform), { recursive: true });
      fs.writeFileSync(path.join(pkg, 'bin', COMMIT, platform, binary), '');
    }
    return pkg;
  }

  it('refuses a pin that moved past what bin/ holds, naming the commit and `npm run fetch:terminal-broker`', () => {
    const refusal = brokerDrift(aBrokerPackage(PLATFORM, false));
    expect(refusal).toContain(`apack-terminal ${COMMIT.slice(0, 7)} is not installed for ${PLATFORM}`);
    expect(refusal).toContain('npm run fetch:terminal-broker');
  });

  it('says nothing when the pinned broker is installed', () => {
    expect(brokerDrift(aBrokerPackage(PLATFORM, true))).toBeUndefined();
  });

  it('says nothing on a platform the pin has no build for, which no install could fetch', () => {
    expect(brokerDrift(aBrokerPackage('plan9-mips', false))).toBeUndefined();
  });
});
