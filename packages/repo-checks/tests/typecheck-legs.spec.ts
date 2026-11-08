import * as fs from 'node:fs';
import * as path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { scopeOf, TYPECHECK_LEGS, type Leg } from '../../../scripts/lib/typecheck-legs.ts';
import { GENERATE_ENTRIES, RECORDED_FILE_CHECKS } from '../../../scripts/lib/typecheck-jobs.ts';
import { rootScripts } from '../../../scripts/lib/npm-scripts.ts';
import { PACKAGE_DIRS } from '../../../scripts/lib/workspace-deps.ts';
import { CHAIN_STEPS } from '../../../scripts/lib/chain-steps.ts';
import { population } from '@apackdev/sdk/testing';

it('preserves the generation environment when checking its outputs in another process', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-typecheck-context-'));
  const pack = path.join(root, 'packages/default-setup');
  const cli = path.join(root, 'packages/apack-cli/bin');
  try {
    fs.mkdirSync(pack, { recursive: true }); fs.mkdirSync(cli, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/default-setup'] }));
    fs.writeFileSync(path.join(pack, 'package.json'), JSON.stringify({ name: '@app/default-setup', scripts: {
      'generate:entries': 'node ../apack-cli/bin/apack.mjs pack generate-entries',
      'facade:check': 'node ../apack-cli/bin/apack.mjs pack facade-report',
    } }));
    fs.writeFileSync(path.join(cli, 'apack.mjs'), `import fs from 'node:fs';
import assert from 'node:assert/strict';
const context = {event:process.env.npm_lifecycle_event,script:process.env.npm_lifecycle_script};
if (process.argv[3] === 'generate-entries') fs.writeFileSync('context.json',JSON.stringify(context));
else assert.deepEqual(context,JSON.parse(fs.readFileSync('context.json','utf8')));`);
    const check = RECORDED_FILE_CHECKS.find(check => check.name === 'facade:check')!;
    for (const job of [GENERATE_ENTRIES, check]) {
      const [command, ...args] = job.command.split(' ');
      await execFileWhileWorking(command!, args, { cwd: path.join(root, path.relative(REPO_ROOT, job.cwd ?? REPO_ROOT)),
        env: { ...process.env, npm_lifecycle_event: 'typecheck', npm_lifecycle_script: 'tsx scripts/typecheck.ts' } });
    }
    expect(JSON.parse(fs.readFileSync(path.join(pack, 'context.json'), 'utf8'))).toEqual({
      event: 'typecheck', script: 'tsx scripts/typecheck.ts',
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

/**
 * A leg's scope comes from its script, and a declared one has something the script cannot say.
 *
 * The script is the source of a leg's scope; a declaration repeating it would be a second record of one
 * fact. What is checked is the shape of the exception rather than the rule: that nothing declares a list the
 * script would have given anyway, that nothing is left without either, and that a declaration names real
 * workspaces.
 */

/** Whether the leg's own script names any workspace — the thing `scopeOf` reads when nothing is declared */
const scriptNames = (leg: Leg): boolean => {
  const command = rootScripts()[leg.name] ?? '';
  return /--workspace[= ]|(?:^|\s)-w[= ]|(?:tsc -p|cd) packages\//.test(command);
};

describe('a typecheck leg takes its scope from its script', () => {
  it('finds legs, and both kinds, so neither branch below is untested', () => {
    const found = population('typecheck legs', [...TYPECHECK_LEGS], { atLeast: 15 });
    expect(found.filter((leg) => leg.scope === undefined).length, 'no leg derives its scope').toBeGreaterThan(8);
    expect(found.filter((leg) => leg.scope !== undefined).length, 'no leg declares one').toBeGreaterThan(0);
  });

  it('resolves a non-empty scope for every leg', () => {
    const broken = TYPECHECK_LEGS.flatMap((leg) => {
      try {
        const scope = scopeOf(leg);
        return scope === 'repo' || scope.length > 0 ? [] : [`${leg.name} resolves an empty scope`];
      } catch (err) {
        return [`${leg.name}: ${(err as Error).message}`];
      }
    });
    expect(broken, 'a leg with no scope gets empty inputs, so it depends on nothing and never goes stale')
      .toEqual([]);
  });

  /**
   * The rule that keeps the twelve from coming back. A declared *list* is only warranted where the script
   * names nothing — otherwise it is the duplicate this change removed, and it can drift from the script
   * while both look right. `'repo'` is exempt: it is strictly wider than any parse, which is its point.
   */
  it('declares a list only where the script names nothing', () => {
    const redundant = TYPECHECK_LEGS
      .filter((leg) => leg.scope !== undefined && leg.scope !== 'repo' && scriptNames(leg))
      .map((leg) => `${leg.name} declares a scope its own script already names — drop it and let scopeOf read it`);
    expect(redundant).toEqual([]);
  });

  /**
   * The property that makes deriving this no weaker than declaring it.
   *
   * A parse that keeps what it understood and drops the rest narrows the scope silently, and a scope short
   * one workspace is a step that stops re-running when that workspace changes. Nothing is unresolved today,
   * so this is the case that keeps it that way rather than one that fires — and "it happens to resolve" is
   * not the same property as "it cannot quietly fail to".
   */
  it('resolves every workspace its scripts name, rather than keeping what it understood', () => {
    const named = TYPECHECK_LEGS.filter((leg) => leg.scope === undefined);
    expect(named.length, 'no leg derives its scope, so this checks nothing').toBeGreaterThan(8);
    const broken = named.flatMap((leg) => {
      try { scopeOf(leg); return []; } catch (err) { return [(err as Error).message]; }
    });
    expect(broken, 'a mention it cannot resolve must be refused, not dropped').toEqual([]);
  });

  it('refuses a leg whose script names a workspace it cannot resolve', () => {
    const invented: Leg = { name: 'typecheck:bogus', command: 'npm run typecheck --workspace @apackdev/not-a-package' };
    // The leg's own `command` is not what is read — the root script of that name is, and there is none here,
    // so this is the no-mentions refusal. The resolvable-mention rule is the case above, over the real table.
    expect(() => scopeOf(invented)).toThrow(/names no workspace, so declare a scope/);
  });

  it('refuses a leg whose script names nothing and which declares nothing', () => {
    const invented: Leg = { name: 'typecheck:nothing', command: 'npm run typecheck:nothing' };
    expect(() => scopeOf(invented)).toThrow(/names no workspace, so declare a scope/);
  });

  it('names only real package directories', () => {
    const unknown = TYPECHECK_LEGS
      .flatMap((leg) => { const s = scopeOf(leg); return s === 'repo' ? [] : s; })
      .filter((dir) => !PACKAGE_DIRS.includes(dir));
    expect([...new Set(unknown)], 'these are not workspaces under packages/').toEqual([]);
  });
});

/**
 * `npm run typecheck` answers for every recorded file, which is the trap it used to leave open: two of the
 * four checks were legs and two were chain steps, so a green run said nothing about `etc/*.api.md` or
 * `etc/pack-types.api.md` and the guide warned about it in prose.
 *
 * Derived rather than restated. A recorded file is a noun with both halves — the `<name>:check` /
 * `<name>:update` convention root `CLAUDE.md` gives and `chain-table.spec.ts` holds the other direction
 * of. Of those, the ones the runner has to borrow are exactly the ones whose check is a chain step and not a
 * leg: a leg it already runs, and a check that is neither is covered by a spec instead
 * (`NOT_RUN_BY_THE_CHAIN`). So a fifth recorded file cannot arrive without either being a leg or landing
 * here.
 */
describe('the recorded files npm run typecheck answers for', () => {
  /** Every `<noun>:check` that has an `<noun>:update` beside it, in the root manifest or a package's */
  const recordedFileChecks = (): string[] => {
    const manifests = [path.join(REPO_ROOT, 'package.json'),
      ...PACKAGE_DIRS.map((dir) => path.join(REPO_ROOT, 'packages', dir, 'package.json'))]
      .filter((file) => fs.existsSync(file));
    return [...new Set(manifests.flatMap((file) => {
      const scripts = (JSON.parse(fs.readFileSync(file, 'utf-8')) as { scripts?: Record<string, string> }).scripts ?? {};
      return Object.keys(scripts)
        .filter((name) => name.endsWith(':update') && scripts[`${name.slice(0, -':update'.length)}:check`] !== undefined)
        .map((name) => `${name.slice(0, -':update'.length)}:check`);
    }))].sort();
  };

  it('are the recorded file checks that are chain steps rather than legs', () => {
    const recordedFiles = population('the recorded files', recordedFileChecks(), { atLeast: 4 });
    const legs = new Set(TYPECHECK_LEGS.map((leg) => leg.name));
    const steps = new Set(CHAIN_STEPS.map((step) => step.name));

    const borrowable = recordedFiles.filter((name) => steps.has(name) && !legs.has(name)).sort();

    expect(RECORDED_FILE_CHECKS.map((check) => check.name).sort()).toEqual(borrowable);
  });

  // Each borrows a step's class, cost and width, so a name that is not a step has nothing to borrow and the
  // runner throws at startup rather than running a short command
  it('each name a chain step the runner can borrow from', () => {
    for (const { name } of RECORDED_FILE_CHECKS) {
      expect(CHAIN_STEPS.find((step) => step.name === name), name).toBeDefined();
    }
  });
});
