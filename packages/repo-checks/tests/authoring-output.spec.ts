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

  it('keeps one work dir per canonical checkout, replacing it read-only directories and all', () => {
    const dir = fixture(), temporary = path.join(dir, 'private-tmp');
    fs.mkdirSync(temporary);
    const root = path.join(dir, 'checkout');
    const previous = run(root, temporary, 'newWorkDir');
    expect(path.basename(previous)).toMatch(/^apack-authoring-[0-9a-f]{64}$/);
    expect(fs.readFileSync(path.join(previous, 'checkout'), 'utf8')).toBe(fs.realpathSync(root));
    // A work dir can hold read-only directories, as a compiler store under its HOME does
    const store = path.join(previous, 'home/Library/Caches/apack-cli/compilers/hash');
    fs.mkdirSync(path.join(store, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(store, 'bin/tool'), 'compiler');
    fs.chmodSync(path.join(store, 'bin'), 0o555);
    fs.chmodSync(store, 0o555);
    const alias = path.join(dir, 'checkout-alias');
    fs.symlinkSync(root, alias, 'dir');
    const current = run(alias, temporary, 'newWorkDir');
    expect(current, 'the same checkout by another path is the same dir').toBe(previous);
    expect(fs.existsSync(path.join(previous, 'home'))).toBe(false);
    expect(fs.readdirSync(temporary).filter(name => name.startsWith('apack-authoring-')), 'and only one').toHaveLength(1);
  });

  it('sweeps the work dirs of checkouts that are gone, and nothing else', () => {
    const dir = fixture(), temporary = path.join(dir, 'private-tmp');
    fs.mkdirSync(temporary);
    const kept = run(path.join(dir, 'kept'), temporary, 'newWorkDir');
    const gone = run(path.join(dir, 'gone'), temporary, 'newWorkDir');
    const goneLive = run(path.join(dir, 'gone-live'), temporary, 'newWorkDir');
    fs.writeFileSync(path.join(goneLive, 'owner'), String(process.pid));
    fs.rmSync(path.join(dir, 'gone'), { recursive: true });
    fs.rmSync(path.join(dir, 'gone-live'), { recursive: true });
    const file = path.join(temporary, `apack-authoring-${'f'.repeat(64)}`);
    const unrelated = path.join(temporary, 'apack-authoring-unrelated');
    fs.writeFileSync(file, 'preserve');
    fs.mkdirSync(unrelated);
    run(path.join(dir, 'another'), temporary, 'newWorkDir');
    expect(fs.existsSync(gone), 'its checkout gone and its owner too').toBe(false);
    for (const preserved of [kept, goneLive, file, unrelated]) expect(fs.existsSync(preserved), preserved).toBe(true);
  });

  it('refuses to replace a work dir a live run of the checkout owns', () => {
    const dir = fixture(), temporary = path.join(dir, 'private-tmp');
    fs.mkdirSync(temporary);
    const root = path.join(dir, 'checkout');
    const work = run(root, temporary, 'newWorkDir');
    fs.writeFileSync(path.join(work, 'owner'), String(process.pid));
    fs.writeFileSync(path.join(work, 'in-use'), 'yes');
    const refused = spawnSync('bash', ['-c', 'source "$1"; newWorkDir', path.join(root, 'tests/scripts/caller.sh'), helper], {
      env: { ...process.env, TMPDIR: temporary }, encoding: 'utf8',
    });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain(`(pid ${process.pid}) is using ${work}`);
    expect(fs.existsSync(path.join(work, 'in-use'))).toBe(true);
  });

  // macOS's user immutable flag makes a file no chmod lets the removal undo; Linux's needs root to set
  it.skipIf(process.platform !== 'darwin')('refuses, naming the work dir, when it cannot replace it', () => {
    const dir = fixture(), temporary = path.join(dir, 'private-tmp');
    fs.mkdirSync(temporary);
    const root = path.join(dir, 'checkout');
    const previous = run(root, temporary, 'newWorkDir');
    const locked = path.join(previous, 'locked');
    fs.writeFileSync(locked, 'immutable');
    execFileSync('chflags', ['uchg', locked]);
    try {
      const refused = spawnSync('bash', ['-c', 'source "$1"; newWorkDir', path.join(root, 'tests/scripts/caller.sh'), helper], {
        env: { ...process.env, TMPDIR: temporary }, encoding: 'utf8',
      });
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toContain(`could not remove the work dir ${previous}`);
    } finally {
      execFileSync('chflags', ['nouchg', locked]);
    }
  });

  it('uses the machine’s compiler store, not one under the work dir’s HOME, keeping one already set', () => {
    const dir = fixture(), home = path.join(dir, 'user-home'), work = path.join(dir, 'work');
    fs.mkdirSync(home);
    fs.mkdirSync(work);
    const root = path.join(dir, 'checkout');
    const caller = path.join(root, 'tests/scripts/caller.sh');
    fs.mkdirSync(path.dirname(caller), { recursive: true });
    // The helper resolves the store with the CLI's own env-paths, from the checkout's CLI package
    fs.symlinkSync(path.join(REPO_ROOT, 'packages'), path.join(root, 'packages'), 'dir');
    const store = (env: NodeJS.ProcessEnv) => execFileSync('bash', ['-c', 'source "$1"; useWorkDir "$2"; echo "$APACK_COMPILER_STORE|$HOME"', caller, helper, work], {
      env: { ...process.env, HOME: home, XDG_CACHE_HOME: '', ...env }, encoding: 'utf8',
    }).trim().split('|');
    const [resolved, moved] = store({ APACK_COMPILER_STORE: '' });
    expect(moved).toBe(path.join(work, 'home'));
    expect(resolved.startsWith(home + path.sep), resolved).toBe(true);
    expect(resolved.endsWith(path.join('apack-cli', 'compilers'))).toBe(true);
    expect(store({ APACK_COMPILER_STORE: '/elsewhere/compilers' })[0]).toBe('/elsewhere/compilers');
    expect(fs.readFileSync(path.join(work, 'owner'), 'utf8').trim()).toMatch(/^\d+$/);
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
