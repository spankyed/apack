import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT, stampedRun, unitStaleReason } from '@apackdev/host/build/packages-built';
import { CHAIN_STEPS, dependsOn } from '../../../scripts/lib/chain-steps.ts';

const helper = path.join(REPO_ROOT, 'tests/scripts/lib/authoring.sh');
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'authoring-output-'));
  roots.push(root);
  return root;
}

function run(root: string, temporary: string, command: string, args: string[] = []): string {
  const caller = path.join(root, 'tests/scripts/caller.sh');
  fs.mkdirSync(path.dirname(caller), { recursive: true });
  return execFileSync('bash', ['-c', `source "$1"; ${command}`, caller, helper, ...args], {
    env: { ...process.env, TMPDIR: temporary }, encoding: 'utf8',
  }).trim();
}

const author = CHAIN_STEPS.find(step => step.name === 'test:packaged-authoring:author')!;

describe('external authoring output ownership', () => {
  it('builds the selected host pack before authoring against its snapshot', () => {
    expect(dependsOn(author)).toContain('build:default-setup');
  });

  it('sweeps dead owners by canonical checkout while preserving foreign, live, unscoped and non-directory entries', () => {
    const dir = fixture(), temporary = path.join(dir, 'private-tmp');
    fs.mkdirSync(temporary);
    const root = path.join(dir, 'checkout'), other = path.join(dir, 'other-checkout');
    const previous = run(root, temporary, 'newWorkDir');
    const foreign = run(other, temporary, 'newWorkDir');
    expect(fs.existsSync(previous)).toBe(true);
    const name = path.basename(previous);
    const prefix = name.replace(/\d+-[A-Za-z0-9]{6}$/, '');
    const deadPid = /([0-9]+)-[A-Za-z0-9]{6}$/.exec(name)![1];
    const live = path.join(temporary, `${prefix}${process.pid}-aaaaaa`);
    const unscoped = path.join(temporary, `apack-authoring-${deadPid}-bbbbbb`);
    const malformed = path.join(temporary, `${prefix}unknown`);
    const file = path.join(temporary, `${prefix}${deadPid}-cccccc`);
    const link = path.join(temporary, `${prefix}${deadPid}-dddddd`);
    const target = path.join(dir, 'outside-sweep');
    for (const directory of [live, unscoped, malformed, target]) fs.mkdirSync(directory);
    fs.writeFileSync(file, 'preserve');
    fs.writeFileSync(path.join(target, 'sentinel'), 'preserve');
    fs.symlinkSync(target, link, 'dir');
    const alias = path.join(dir, 'checkout-alias');
    fs.symlinkSync(root, alias, 'dir');
    // A work dir holds read-only directories, as the CLI's compiler store under its HOME does
    const store = path.join(previous, 'home/Library/Caches/apack-cli/compilers/hash');
    fs.mkdirSync(path.join(store, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(store, 'bin/tool'), 'compiler');
    fs.chmodSync(path.join(store, 'bin'), 0o555);
    fs.chmodSync(store, 0o555);
    const current = run(alias, temporary, 'newWorkDir');
    expect(path.basename(current).startsWith(prefix)).toBe(true);
    expect(fs.existsSync(previous)).toBe(false);
    for (const kept of [current, foreign, live, unscoped, malformed, file, link, path.join(target, 'sentinel')]) {
      expect(fs.existsSync(kept), kept).toBe(true);
    }
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  // macOS's user immutable flag makes a file no chmod lets the sweep remove; Linux's needs root to set
  it.skipIf(process.platform !== 'darwin')('names a dead work dir it could not remove, rather than skipping it silently', () => {
    const dir = fixture(), temporary = path.join(dir, 'private-tmp');
    fs.mkdirSync(temporary);
    const root = path.join(dir, 'checkout');
    const previous = run(root, temporary, 'newWorkDir');
    const locked = path.join(previous, 'locked');
    fs.writeFileSync(locked, 'immutable');
    execFileSync('chflags', ['uchg', locked]);
    try {
      const swept = spawnSync('bash', ['-c', 'source "$1"; newWorkDir', path.join(root, 'tests/scripts/caller.sh'), helper], {
        env: { ...process.env, TMPDIR: temporary }, encoding: 'utf8',
      });
      expect(swept.status).toBe(0);
      expect(swept.stderr).toContain(`could not remove the dead work dir ${previous}`);
      expect(fs.existsSync(locked)).toBe(true);
    } finally {
      execFileSync('chflags', ['nouchg', locked]);
    }
  });

  it('orders this checkout’s app consumer after its author producer', () => {
    const app = CHAIN_STEPS.find(step => step.name === 'test:packaged-authoring:app')!;
    expect(dependsOn(app)).toContain(author.name);
  });

  it.each(['archive deletion', 'work deletion', 'readiness deletion', 'archive tampering', 'archive link replacement'] as const)(
    'invalidates a successful stamp after %s while work.json remains', async change => {
      const dir = fixture(), root = path.join(dir, 'checkout'), work = path.join(dir, 'external');
      fs.mkdirSync(work);
      const archive = path.join(work, 'fixture.tgz');
      fs.writeFileSync(archive, 'fixture');
      run(root, dir, 'WORK="$2"; ARCHIVE="$3"; PACK="$2/pack"; writeAuthoringHandoff', [work, archive]);
      const handoff = path.join(root, 'tests/authoring-handoff');
      const unit = { inputs: [], outputs: author.outputs!.map(output => path.join(root, output)) };
      const stamp = path.join(dir, 'successful-stamp.json');
      await stampedRun('author output', unit, stamp, () => {});
      expect(unitStaleReason(unit, stamp)).toBeNull();
      const metadata = fs.readFileSync(path.join(handoff, 'work.json'));
      if (change === 'archive deletion') fs.unlinkSync(archive);
      if (change === 'work deletion') fs.rmSync(work, { recursive: true });
      if (change === 'readiness deletion') fs.unlinkSync(path.join(work, 'authoring-ready'));
      if (change === 'archive tampering') fs.writeFileSync(archive, 'changed');
      if (change === 'archive link replacement') {
        const replacement = path.join(dir, 'replacement.tgz');
        fs.writeFileSync(replacement, 'different archive');
        fs.unlinkSync(path.join(handoff, 'archive'));
        fs.symlinkSync(replacement, path.join(handoff, 'archive'));
      }
      expect(fs.readFileSync(path.join(handoff, 'work.json'))).toEqual(metadata);
      const reason = unitStaleReason(unit, stamp);
      if (change === 'archive tampering' || change === 'archive link replacement') {
        expect(reason).toBe('its outputs changed since the last successful run');
      } else {
        expect(reason).toContain('not built (no');
      }
    },
  );
});
