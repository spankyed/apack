import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  profileDir,
  profileFor,
  profileNameProblem,
  listProfiles,
  mintProfile,
  openProfile,
  parseProfileFlags,
  removeProfile,
  renameProfile,
} from '../../src/app/profiles';
import type { CliDirs } from '../../src/app/pack-host';
import { APP_ENVS, resolveAppEnvironment } from '@apackdev/sdk/env';
import { askTarget } from '../../src/commands/drive';

let tmp: string;
let dirs: CliDirs;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-profiles-'));
  dirs = { cache: path.join(tmp, 'cache'), data: path.join(tmp, 'data') };
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const root = () => path.join(dirs.data, 'profiles');

/**
 * A name reaches `path.join`, and for an ephemeral profile it reaches `fs.rm`. The user's rule for this
 * whole feature is that production data is never touched by it, and an unchecked name is the one way it
 * could be: `--profile ../../apack` is the real production data dir on macOS.
 */
describe('a profile name', () => {
  it('cannot climb out of the profiles directory', () => {
    for (const name of ['../../apack', '../apack-dev', 'a/b', 'a\\b', '..', '.', '']) {
      expect(() => profileDir(dirs, name), name).toThrow();
    }
  });

  it('refuses names a filesystem would mangle', () => {
    expect(profileNameProblem('con')).toMatch(/reserved/);
    expect(profileNameProblem('trailing.')).toMatch(/reserved/);
    expect(profileNameProblem('-leading')).toMatch(/usable/);
    expect(profileNameProblem('x'.repeat(65))).toMatch(/usable/);
  });

  it('takes the ordinary ones', () => {
    for (const name of ['probe', 'my-pack.2', 'A_1']) expect(profileNameProblem(name), name).toBeUndefined();
  });
});

describe('opening a profile', () => {
  it('creates it the first time and reuses it after', () => {
    const first = openProfile(dirs, 'probe');
    fs.writeFileSync(path.join(first.dir, 'marker'), 'x');
    const again = openProfile(dirs, 'probe');
    expect(again.dir).toBe(first.dir);
    expect(fs.existsSync(path.join(again.dir, 'marker')), 'reopening must not wipe it').toBe(true);
  });

  it('mints a named profile whose name can be used again', () => {
    const minted = mintProfile(dirs, false);
    expect(profileNameProblem(minted.name), 'a minted name has to be one --profile accepts').toBeUndefined();
    expect(openProfile(dirs, minted.name).dir).toBe(minted.dir);
  });
});

describe('ephemeral profiles', () => {
  it('are kept apart from named ones, so reclaiming by pid cannot eat a name', () => {
    const ephemeral = mintProfile(dirs, true);
    expect(path.dirname(ephemeral.dir)).toBe(path.join(root(), '.ephemeral'));
    expect(listProfiles(dirs).filter(i => !i.ephemeral), 'it is not a named profile').toEqual([]);
  });

  it('count as leaked only once the run that made them has gone', () => {
    mintProfile(dirs, true);
    expect(listProfiles(dirs)[0], 'this process is still alive').toMatchObject({ ephemeral: true, leaked: false });

    // A dir left by a run that is no longer here, which is what a crash leaves
    const dead = path.join(root(), '.ephemeral', '999999-gone');
    fs.mkdirSync(dead, { recursive: true });
    fs.writeFileSync(path.join(dead, '.apack-profile.json'), JSON.stringify({ kind: 'source', created: '', pid: 999999 }));
    expect(listProfiles(dirs).find(i => i.name === '999999-gone')).toMatchObject({ leaked: true });
  });
});

/**
 * What may be removed is a profile, and the guard is phrased that way rather than as "inside the
 * root" — a containment rule admits a container for every level it does not enumerate, and this one
 * admitted two in turn: the root, which holds every profile, and `.ephemeral`, which holds every
 * throwaway one. Neither had a caller; each was one future caller away from deleting everything.
 */
describe('what removing accepts', () => {
  it('takes a named profile and an ephemeral one, which is what every caller passes', () => {
    const named = openProfile(dirs, 'keep-me');
    const ephemeral = mintProfile(dirs, true);
    removeProfile(dirs, named.dir);
    removeProfile(dirs, ephemeral.dir);
    expect(fs.existsSync(named.dir)).toBe(false);
    expect(fs.existsSync(ephemeral.dir)).toBe(false);
  });

  it('refuses the profiles root, and every profile under it survives', () => {
    const named = openProfile(dirs, 'keep-me');
    expect(() => removeProfile(dirs, root())).toThrow(/the profiles directory itself/);
    expect(fs.existsSync(named.dir)).toBe(true);
  });

  it('refuses the directory the ephemeral ones live in, and they survive', () => {
    const one = mintProfile(dirs, true);
    const two = mintProfile(dirs, true);
    expect(() => removeProfile(dirs, path.dirname(one.dir))).toThrow(/every ephemeral profile lives/);
    expect(fs.existsSync(one.dir) && fs.existsSync(two.dir)).toBe(true);
  });

  it('refuses a directory inside a profile, which is data rather than a profile', () => {
    const named = openProfile(dirs, 'keep-me');
    expect(() => removeProfile(dirs, path.join(named.dir, 'packs'))).toThrow(/a profile is a directory/);
  });

  it('refuses anything outside, and leaves it alone', () => {
    const outside = path.join(tmp, 'not-an-profile');
    fs.mkdirSync(outside, { recursive: true });
    expect(() => removeProfile(dirs, outside)).toThrow(/is not inside/);
    expect(fs.existsSync(outside)).toBe(true);
  });

  // `path.relative` renders a sibling of the root as `../<name>`, which splits into two segments and
  // would pass a check that only counted them
  it('refuses a sibling of the root whose relative path looks like a nested profile', () => {
    const sibling = path.join(dirs.data, 'profiles-old');
    fs.mkdirSync(sibling, { recursive: true });
    expect(() => removeProfile(dirs, sibling)).toThrow(/is not inside/);
    expect(fs.existsSync(sibling)).toBe(true);
  });
});

describe('renaming a profile', () => {
  it('moves the directory and leaves the name free', () => {
    const made = openProfile(dirs, 'memo-work');
    fs.writeFileSync(path.join(made.dir, 'proof'), 'x');

    const { dir } = renameProfile(dirs, 'memo-work', 'memos');

    expect(dir).toBe(path.join(root(), 'memos'));
    expect(fs.readFileSync(path.join(dir, 'proof'), 'utf-8')).toBe('x');
    expect(fs.existsSync(made.dir)).toBe(false);
  });

  /**
   * Refused rather than merged into: `fs.renameSync` onto a directory throws or replaces depending on the
   * platform and whether the target is empty, and neither is an answer to "rename this".
   */
  it('refuses a target that already exists, and moves nothing', () => {
    openProfile(dirs, 'one');
    openProfile(dirs, 'two');

    expect(() => renameProfile(dirs, 'one', 'two')).toThrow(/already exists/);
    expect(fs.existsSync(path.join(root(), 'one'))).toBe(true);
  });

  it('refuses a target name a filesystem would mangle', () => {
    openProfile(dirs, 'one');
    expect(() => renameProfile(dirs, 'one', '../escape')).toThrow(/profile name/);
    expect(fs.existsSync(path.join(root(), 'one'))).toBe(true);
  });

  it('says so when there is nothing by that name', () => {
    expect(() => renameProfile(dirs, 'absent', 'present')).toThrow(/No profile named "absent"/);
  });

  // The same refusal `removeProfile` carries, one step worse: a running app holds paths inside the
  // directory, so moving it leaves the app writing somewhere that no longer exists
  it('refuses while an app has it open', () => {
    const live = openProfile(dirs, 'live');
    const { appDir } = resolveAppEnvironment({ env: 'development', userDataDir: live.dir });
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'api-runtime.json'), JSON.stringify({ pid: process.pid }));

    expect(() => renameProfile(dirs, 'live', 'moved')).toThrow(/An app is running on/);
    expect(fs.existsSync(live.dir)).toBe(true);
  });
});

describe('the flags', () => {
  it('take the profile ones out and leave the rest for the app parser', () => {
    expect(parseProfileFlags(['--profile', 'probe', '--app', '/repo']))
      .toEqual({ mode: { kind: 'named', name: 'probe', rm: false }, withSecrets: false, rest: ['--app', '/repo'] });
    expect(parseProfileFlags(['--profile=probe']).mode).toEqual({ kind: 'named', name: 'probe', rm: false });
    expect(parseProfileFlags(['--fresh']).mode).toEqual({ kind: 'fresh', rm: false });
    expect(parseProfileFlags([]).mode).toEqual({ kind: 'shared' });
  });

  /**
   * `--rm` is a modifier rather than a mode of its own: one flag says which dir, and this one says whether
   * it survives the command. Either order is the same request, since the combination is a property of the
   * whole argv rather than of the order the flags arrived in.
   */
  it('read --rm as a modifier on --fresh, in either order', () => {
    expect(parseProfileFlags(['--fresh', '--rm']).mode).toEqual({ kind: 'fresh', rm: true });
    expect(parseProfileFlags(['--rm', '--fresh']).mode).toEqual({ kind: 'fresh', rm: true });
  });

  // With no profile at all there is no directory this command made, so the flag has nothing to remove, and
  // the two things it could otherwise be read as are `apack profiles rm <name>` and the shared data dir
  it('refuse --rm with no profile to create, naming what does remove one', () => {
    expect(() => parseProfileFlags(['--rm'])).toThrow(/removes the profile this command creates/);
    expect(() => parseProfileFlags(['--rm'])).toThrow(/apack profiles rm/);
  });

  /**
   * **`--rm` takes a name**, which `drive`'s one-shot path needs: an app that outlives the command has to
   * have a findable dir while it lives, so it cannot be the hidden `.ephemeral` one `--fresh --rm` mints.
   * `profileFor` holds the half that keeps it safe — only a dir this run creates.
   */
  it('read --rm on a name as the same request', () => {
    expect(parseProfileFlags(['--profile', 'probe', '--rm']).mode).toEqual({ kind: 'named', name: 'probe', rm: true });
    expect(parseProfileFlags(['--rm', '--profile=probe']).mode).toEqual({ kind: 'named', name: 'probe', rm: true });
  });

  it('refuse two at once, which would silently pick one', () => {
    expect(() => parseProfileFlags(['--profile', 'a', '--fresh'])).toThrow();
  });

  // --with-secrets is orthogonal to which profile, so it rides alongside the mode rather than inside it
  it('carries --with-secrets beside the mode', () => {
    expect(parseProfileFlags(['--fresh', '--rm', '--with-secrets']))
      .toEqual({ mode: { kind: 'fresh', rm: true }, withSecrets: true, rest: [] });
    expect(parseProfileFlags(['--profile', 'probe']).withSecrets).toBe(false);
  });

  // The shared data dir already holds them, so there is nothing to copy into: a silent no-op here would
  // read as if it had done something
  it('refuses --with-secrets with no profile to copy into', () => {
    expect(() => parseProfileFlags(['--with-secrets'])).toThrow(/needs a profile/);
  });

  it.each(['--fresh', '--rm', '--with-secrets'])('rejects an inline value for %s', flag => {
    expect(() => parseProfileFlags(['--fresh', `${flag}=false`])).toThrow('does not take a value');
  });

  it('needs a name for --profile', () => {
    expect(() => parseProfileFlags(['--profile', '--fresh'])).toThrow(/needs a name/);
    expect(() => parseProfileFlags(['--profile'])).toThrow(/needs a name/);
  });

  // The default has to stay the shared dev dir: `dev` with no flag must behave exactly as it did
  it('resolve nothing for the shared default', () => {
    expect(profileFor({ kind: 'shared' }, dirs)).toBeUndefined();
  });

  /**
   * `--fresh --rm` removes what `--fresh` keeps, which is the one behavioural claim in this rename. The
   * two land in different places on disk and that is what decides it: `.ephemeral/` is where a run's own
   * teardown looks, and `ephemeral` on the result is what tells it to. A `--fresh` that minted into
   * `.ephemeral` would be removed by the run that made it, having promised a name to come back to.
   */
  it('mint a kept profile and a removed one in different places', () => {
    const kept = profileFor({ kind: 'fresh', rm: false }, dirs)!;
    const removed = profileFor({ kind: 'fresh', rm: true }, dirs)!;

    expect(kept.ephemeral).toBe(false);
    expect(path.dirname(kept.dir)).toBe(root());
    expect(removed.ephemeral).toBe(true);
    expect(path.dirname(removed.dir)).toBe(path.join(root(), '.ephemeral'));
    // The kept one is reachable by the name it printed; the removed one is not named for coming back to
    expect(listProfiles(dirs).filter((profile) => !profile.ephemeral).map((profile) => profile.name)).toEqual([kept.name]);
  });
});

/**
 * The app outlives the `apack pack dev` that started it, so the run's pid is not enough to call a directory
 * abandoned. Found by killing a run, reclaiming what looked like its leak, and watching the app that was
 * still going rebuild the directory underneath — the removal had only corrupted what was in it.
 */
describe('a profile an app still has open', () => {
  // Where the API actually publishes it, asked of the same resolver the app uses — a literal path here is a
  // second guess, and the one time it disagreed with the app this assertion still passed
  const publishApi = (dir: string, pid: number) => {
    const { appDir } = resolveAppEnvironment({ env: 'development', userDataDir: dir });
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'api-runtime.json'), JSON.stringify({ pid }));
  };

  it('is in use, and not a leak, even when the run that made it has gone', () => {
    const dead = path.join(root(), '.ephemeral', '999999-gone');
    fs.mkdirSync(dead, { recursive: true });
    fs.writeFileSync(path.join(dead, '.apack-profile.json'), JSON.stringify({ kind: 'source', created: '', pid: 999999 }));
    publishApi(dead, process.pid);

    expect(listProfiles(dirs)[0]).toMatchObject({ inUse: true, leaked: false });
  });

  it('refuses to be removed', () => {
    const live = openProfile(dirs, 'live');
    publishApi(live.dir, process.pid);
    expect(() => removeProfile(dirs, live.dir)).toThrow(/An app is running on/);
    expect(fs.existsSync(live.dir)).toBe(true);
  });
});

/**
 * **The dir a question waits on is the dir the spawn it starts opens.**
 *
 * This is the case the defect it was written for had no home for. `drive`'s one-shot path answered "which
 * data dir" in two places — one resolving a *place*, one building the *flags* for the spawned `dev` — and
 * they disagreed about `--fresh`: the first said the development dir, the second passed `--fresh`, and
 * `dev` minted a dir of its own. So the question either attached to whatever was on the development dir,
 * ignoring the flag, or waited two minutes for a session at a path nothing would write.
 *
 * It is a round trip rather than two assertions, which is what makes it hold: `spawnArgs` go back through
 * the parser the spawned `dev` uses, through the `profileFor` it calls, to the dir it would resolve. Any
 * answer that is not `dir` fails, whichever side moved.
 */
describe("a question's dir and the spawn that opens it", () => {
  const devWouldOpen = (spawnArgs: readonly string[]): string => {
    const { mode } = parseProfileFlags([...spawnArgs]);
    const profile = profileFor(mode, dirs);
    return resolveAppEnvironment({ env: 'development', ...(profile ? { userDataDir: profile.dir } : {}) }).userDataDir;
  };

  it.each([
    [[], 'the development dir'],
    [['--spawn'], 'the development dir, with the flag that permits one'],
    [['--profile', 'probe'], 'a named profile'],
    [['--profile', 'probe', '--rm'], 'a named profile it removes after'],
    [['--fresh'], 'a profile nobody has used'],
    [['--fresh', '--rm'], 'a profile nobody has used, removed after'],
  ])('agree for %s — %s', (argv) => {
    const { mode, withSecrets } = parseProfileFlags(argv.filter((arg) => arg !== '--spawn'));
    const target = askTarget(mode, withSecrets, dirs);
    expect(devWouldOpen(target.spawnArgs)).toBe(target.dir);
  });

  /**
   * `--fresh` resolves to a name here, so the two sides have something to agree on before the dir exists —
   * and it must still be a *new* name, which is the half a reused one would break silently.
   */
  it('names a fresh profile without creating it, and a different one each time', () => {
    const one = askTarget({ kind: 'fresh', rm: false }, false, dirs);
    const two = askTarget({ kind: 'fresh', rm: false }, false, dirs);
    expect(one.dir).not.toBe(two.dir);
    expect(fs.existsSync(one.dir)).toBe(false);
    expect(fs.existsSync(root())).toBe(false);
    expect(one.note).toMatch(/Fresh profile/);
  });

  /** `--with-secrets` has to reach the spawn, or it is a flag that silently did nothing. */
  it('carries --with-secrets to the spawn', () => {
    expect(askTarget({ kind: 'fresh', rm: false }, true, dirs).spawnArgs).toContain('--with-secrets');
    expect(askTarget({ kind: 'named', name: 'probe', rm: false }, true, dirs).spawnArgs).toContain('--with-secrets');
    expect(askTarget({ kind: 'shared' }, false, dirs).spawnArgs).toEqual([]);
  });
});

describe('--rm on a name', () => {
  it('is honoured for a profile this run creates', () => {
    const opened = profileFor({ kind: 'named', name: 'probe', rm: true }, dirs);
    expect(opened).toMatchObject({ name: 'probe', ephemeral: true, created: true });
  });

  /**
   * A profile that was already there holds data somebody kept, and a run that removed it on the way out
   * would be deleting it on the strength of a flag meaning "clean up after me". Refused, not ignored.
   */
  it('is refused for one that was already there, naming what does remove it', () => {
    openProfile(dirs, 'probe');
    expect(() => profileFor({ kind: 'named', name: 'probe', rm: true }, dirs)).toThrow(/already there/);
    expect(() => profileFor({ kind: 'named', name: 'probe', rm: true }, dirs)).toThrow(/apack profiles rm probe/);
    expect(fs.existsSync(profileDir(dirs, 'probe'))).toBe(true);
  });

  it('leaves a named profile alone without it', () => {
    expect(profileFor({ kind: 'named', name: 'probe', rm: false }, dirs)).toMatchObject({ ephemeral: false });
  });

  /**
   * **The dir existing is not the same question as the profile existing**, and `--rm` turns on the answer.
   * `drive`'s spawn opens its log inside the data dir before `dev` starts, so by the time `dev` opens the
   * profile the directory is there — and an existing-dir test refused `--rm` for a dir the run was in the
   * middle of creating. Found by running it, after the specs passed.
   */
  it('is honoured for a dir a caller made but never recorded', () => {
    fs.mkdirSync(profileDir(dirs, 'probe'), { recursive: true });
    fs.writeFileSync(path.join(profileDir(dirs, 'probe'), 'dev-spawn.log'), 'starting\n');
    expect(profileFor({ kind: 'named', name: 'probe', rm: true }, dirs)).toMatchObject({ created: true, ephemeral: true });
  });
});

/**
 * **A profile is never named after a build**, which is the one place this vocabulary could be put back
 * where it started: `--profile beta` and `--host beta` a letter apart, one a data dir and the other the
 * app that opens it. A name is the only input here a user picks freely, so it is the only way a build name
 * could reappear as storage.
 *
 * It was not enforced — `apack profiles new beta` made the directory — and the Outcome had recorded the
 * property as held. Derived from `APP_ENVS` rather than a list of its own, so a fifth build arrives
 * refused rather than nameable, which is what the `it.each` below holds.
 */
describe('a name that is an app data namespace', () => {
  it.each(APP_ENVS)('is refused, and says what each word names: %s', (build) => {
    expect(profileNameProblem(build)).toMatch(/built-in profile/);
    expect(profileNameProblem(build)).toContain(`${build}-work`);
  });

  /** Every door goes through `profileDir`, so none of them has to remember the rule. */
  it.each(APP_ENVS)('cannot reach a directory either: %s', (build) => {
    expect(() => profileDir(dirs, build)).toThrow(/built-in profile/);
    expect(() => openProfile(dirs, build)).toThrow(/built-in profile/);
    expect(fs.existsSync(path.join(root(), build))).toBe(false);
  });

  /** Only the whole name. A build's name inside a longer one is an ordinary name and must stay usable. */
  it('is not a name that merely contains one', () => {
    for (const name of ['beta-work', 'my-production', 'development-2', 'testing']) {
      expect(profileNameProblem(name), name).toBeUndefined();
    }
  });
});

it('a temporary profile is attachable by its printed name without transferring cleanup ownership', () => {
  const owned = mintProfile(dirs, true);
  const target = askTarget({ kind: 'named', name: owned.name, rm: false }, false, dirs);
  expect(target.dir).toBe(owned.dir);
  const reused = profileFor({ kind: 'named', name: owned.name, rm: false }, dirs);
  expect(reused).toMatchObject({ dir: owned.dir, created: false, ephemeral: false });
  expect(() => profileFor({ kind: 'named', name: owned.name, rm: true }, dirs)).toThrow('--rm won');
  expect(fs.existsSync(owned.dir)).toBe(true);
});


it('keeps fresh profile names distinct when a timestamp would consume the ID length budget', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(36 ** 10);
  try {
    const one = mintProfile(dirs, true);
    const two = mintProfile(dirs, true);
    expect(one.dir).not.toBe(two.dir);
    expect(fs.existsSync(one.dir) && fs.existsSync(two.dir)).toBe(true);
  } finally { clock.mockRestore(); }
});
