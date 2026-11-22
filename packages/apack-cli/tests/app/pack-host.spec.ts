import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configuredHostPackagesDir,
  deriveHost,
  packagedAppPackagesDir,
  parseHostFlags,
  resolvePackHost,
  resolveRepositoryHost,
  type CliDirs,
} from '../../src/app/pack-host';
import { fixtureEnv } from '../../src/commands/test';
import { cliBin } from '../../src/utils';
import { packagedExecutable } from '../../src/app/beta-app';

let tmp: string;
let dirs: CliDirs;

function makeCheckout(name: string, { built = true } = {}): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, 'packages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.4.0' }));
  fs.writeFileSync(path.join(root, 'packages', 'entry-point.mjs'), '');
  fs.mkdirSync(path.join(root, 'node_modules', 'electron'), { recursive: true });
  if (built) {
    fs.mkdirSync(path.join(root, 'packages', 'main', 'dist'), { recursive: true });
    fs.mkdirSync(path.join(root, 'packages', 'renderer', 'dist'), { recursive: true });
  }
  return root;
}

const beta = vi.fn(async (_range: string, _cacheDir: string) => ({ version: '0.4.0-beta.2', executable: cacheBeta('0.4.0-beta.2') }));

/**
 * A downloaded beta in the cache, as `ensureBetaApp` leaves one: the tag names the directory, and
 * `appVersion` writes the bundle's own `package.json` — the two differ for a promoted beta, which is what
 * the range is matched on.
 */
function cacheBeta(tag: string, appVersion?: string): string {
  const executable = packagedExecutable(path.join(dirs.cache, 'apps', 'beta', tag));
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, '');
  {
    const metadataDir = path.join(path.dirname(path.dirname(executable)), 'Resources', 'app');
    fs.mkdirSync(metadataDir, { recursive: true });
    fs.writeFileSync(path.join(metadataDir, 'build-manifest.json'), JSON.stringify({ channel: appVersion ? 'production' : 'beta', version: appVersion ?? tag, productName: 'apack Beta' }));
  }
  if (appVersion !== undefined) {
    const appDir = path.join(path.dirname(path.dirname(executable)), 'Resources', 'app');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ version: appVersion }));
  }
  return executable;
}
/**
 * A checkout `checkoutFor` would find, which the fixture above is not: it writes no `package.json` and no
 * `node_modules/@apackdev/*`, so the real resolver answers `undefined` for every one of them. The derivation
 * is therefore driven through an injected `checkout`, and `checkoutFor`'s own behaviour is covered by
 * `tests/build/checkout-packages.spec.ts` — one seam, tested on its own side.
 */
const finds = (root: string | undefined) => (_from: string): string | undefined => root;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-pack-host-'));
  dirs = { cache: path.join(tmp, 'cache'), data: path.join(tmp, 'data') };
  beta.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('explicit app selection', () => {
  it('treats a directory named beta as a path', () => {
    expect(parseHostFlags(['--host', './beta']).host).toBe(path.resolve('beta'));
    expect(parseHostFlags(['--host', 'beta']).host).toBe('beta');
  });
  it('refuses conflicting selectors and release channels without an authoring host', () => {
    expect(() => parseHostFlags(['--host', '.', '--host', 'beta'])).toThrow('Specify --host once');
    expect(() => parseHostFlags(['--channel', 'production'])).toThrow('not a pack host selector');
  });
});

describe('parseHostFlags', () => {
  it('takes the app flags out of the Playwright args', () => {
    expect(parseHostFlags(['--host', '/repo', '-g', 'renders', 'smoke'])).toEqual({
      host: '/repo',
      args: ['-g', 'renders', 'smoke'],
    });
  });

  it('takes --release too, so Playwright never sees it', () => {
    expect(parseHostFlags(['--release', '-g', 'renders'])).toEqual({ release: true, args: ['-g', 'renders'] });
    expect(parseHostFlags(['-g', 'renders'])).toEqual({ args: ['-g', 'renders'] });
  });

  it('rejects unknown app channels', () => {
    expect(() => parseHostFlags(['--host'])).toThrow(/--host needs a path or beta/);
  });
});

/**
 * The half that may not consult machine state.
 *
 * `resolveTestApp` used to fall through to `~/.config/apack-cli/config.json` and, in a terminal, to a
 * question whose answer it persisted — so a pack's test result depended on what someone typed once on
 * that machine. The data layer was never the problem: the fixture always takes a fresh `mkdtemp` and
 * forces `env: 'test'`, which is why this hid — the isolation you check for is real, one layer below the
 * leak. These cases fail the moment the config read comes back.
 */
/**
 * The policy for a command driving the app with no pack in front of it — `npm run dev:drive --` at an apack
 * checkout, which is how this repo's own `npm run dev:drive` scripts reach it.
 */
/**
 * The derivation that replaced a question asked once and stored for every pack on the machine.
 *
 * `checkout` is injected: the `makeCheckout` fixture is a launchable tree, not one the real resolver can
 * find, and the two seams are tested on their own sides.
 */
it.each(['--release', '--prebuilt'])('rejects an inline value for %s', flag => {
  expect(() => parseHostFlags([`${flag}=false`])).toThrow('does not take a value');
});

describe('deriveHost', () => {
  const derive = (overrides: Partial<Parameters<typeof deriveHost>[0]> = {}) =>
    deriveHost({ policy: 'development', flags: { args: [] }, hostVersion: '>=0.3.0', from: tmp, dirs, env: {}, betaApp: beta, checkout: finds(undefined), ...overrides });

  it('uses the checkout the pack is built against, without reaching for a beta', async () => {
    const root = makeCheckout('linked');

    await expect(derive({ checkout: finds(root) })).resolves.toMatchObject({ target: { kind: 'source', root: fs.realpathSync(root) } });
    expect(beta, 'a checkout answered, so nothing should have been downloaded').not.toHaveBeenCalled();
  });

  // The other half: "derived" is not "always a checkout", and this is what says the second rule runs
  it('falls to the beta its hostVersion accepts when there is no checkout', async () => {
    await expect(derive()).resolves.toMatchObject({ target: { kind: 'packaged', version: '0.4.0-beta.2' } });
    expect(beta).toHaveBeenCalledWith('>=0.3.0', dirs.cache);
  });

  it('lets a named app beat both', async () => {
    const named = makeCheckout('named');
    const derived = makeCheckout('derived');

    await expect(derive({ flags: { host: named, args: [] }, checkout: finds(derived) }))
      .resolves.toMatchObject({ target: { kind: 'source', root: fs.realpathSync(named) } });
    await expect(derive({ env: { APACK_HOST: named }, checkout: finds(derived) }))
      .resolves.toMatchObject({ target: { kind: 'source', root: fs.realpathSync(named) } });
    await expect(derive({ flags: { host: 'beta', args: [] }, checkout: finds(derived) }))
      .resolves.toMatchObject({ target: { kind: 'packaged' } });
  });

  /**
   * The decision this rests on: a derived checkout that cannot be launched **fails**, rather than quietly
   * becoming a beta. Falling through would pair a pack compiled against checkout source with a released
   * host — the mismatch the derivation exists to prevent — with a warning as the only thing between that
   * and a confusing runtime failure.
   */
  it('refuses an unbuilt checkout instead of falling through to a beta', async () => {
    const raw = makeCheckout('raw', { built: false });

    await expect(derive({ checkout: finds(raw) })).rejects.toThrow(/npm run build:default-setup && npm run build:runtime/);
    expect(beta, 'it must not answer with a beta the pack was not built against').not.toHaveBeenCalled();
  });

  it('says which rule answered, so a derivation is never silent', async () => {
    const stated = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = makeCheckout('announced');

    await resolvePackHost({ policy: 'development', flags: { args: [] }, hostVersion: '*', from: tmp, dirs, env: {}, betaApp: beta, checkout: finds(root) });

    expect(stated.mock.calls.flat().join(' ')).toContain('checkout');
  });

  /**
   * **The case that proves the feature.** `~/Library/Preferences/apack-cli/config.json` held the answer to
   * a question asked once, and every run used it for every pack. Nothing reads it now, so a file sitting
   * there changes no answer — and this is the only thing that says so.
   */
  it('ignores a config file left by an older version', async () => {
    const stale = makeCheckout('stale-preference');
    const config = path.join(tmp, 'config');
    fs.mkdirSync(config, { recursive: true });
    fs.writeFileSync(path.join(config, 'config.json'), JSON.stringify({ host: { source: stale } }));

    await expect(derive()).resolves.toMatchObject({ target: { kind: 'packaged' } });
  });

  it('expands ~ in a named checkout path', async () => {
    const name = `apack-pack-host-home-${process.pid}`;
    const root = makeCheckout('home-checkout');
    const link = path.join(os.homedir(), name);
    fs.rmSync(link, { recursive: true, force: true });
    fs.symlinkSync(root, link, 'dir');
    try {
      await expect(derive({ flags: { host: `~/${name}`, args: [] } }))
        .resolves.toMatchObject({ target: { kind: 'source', root: fs.realpathSync(root) } });
    } finally {
      fs.rmSync(link, { recursive: true, force: true });
    }
  });
});

describe('resolveTestHost', () => {
  const pinned = (overrides: Partial<Parameters<typeof resolvePackHost>[0]> = {}) =>
    resolvePackHost({ policy: 'test', flags: { args: [] }, hostVersion: '>=0.3.0', dirs, env: {}, betaApp: beta, ...overrides });

  // It also derives no checkout, which is the difference from `deriveHost` now that neither reads a
  // preference: a pinned run answers from the manifest so that it means the same thing on any machine
  it('pins from hostVersion, deriving nothing from where the pack happens to sit', async () => {
    makeCheckout('beside-it');

    await expect(pinned()).resolves.toMatchObject({ kind: 'packaged', version: '0.4.0-beta.2' });
    expect(beta, 'it pinned from hostVersion rather than looking around').toHaveBeenCalledWith('>=0.3.0', dirs.cache);
  });

  // There is nothing to ask about: the manifest's hostVersion always yields an answer, which is why
  // dropping the config read leaves no hole
  it('needs no prompt and no terminal, so CI and a laptop agree', async () => {
    await expect(pinned()).resolves.toMatchObject({ kind: 'packaged' });
  });

  it('still takes an explicitly named app', async () => {
    const root = makeCheckout('explicit');
    await expect(pinned({ flags: { host: root, args: [] } })).resolves.toEqual({ kind: 'source', root: fs.realpathSync(root) });
    await expect(pinned({ env: { APACK_HOST: root } })).resolves.toEqual({ kind: 'source', root: fs.realpathSync(root) });
  });

  /**
   * The defect this closes: it listed GitHub's releases on every run and skipped only the *download*, so a
   * cached build was unusable offline and CI paid an API call per run — while `packagedTarget`'s own doc said
   * "downloaded if it isn't cached". One rule now, shared with `configuredHostPackagesDir`.
   */
  it('answers from the cache without reaching the network, named or not', async () => {
    const executable = cacheBeta('0.4.0-beta.9');

    await expect(pinned()).resolves.toEqual({ kind: 'packaged', version: '0.4.0-beta.9', executable });
    await expect(pinned({ flags: { host: 'beta', args: [] } })).resolves.toMatchObject({ version: '0.4.0-beta.9' });
    expect(beta, 'a downloaded build satisfied the range, so nothing should have been fetched').not.toHaveBeenCalled();
  });

  // What makes cache-first safe rather than merely cheap: the range is still the question, so a cached build
  // the pack cannot run is not an answer. `cachedBetaApp` matching on the app's own version is what this asks
  it('falls through to the network when no cached build satisfies the range', async () => {
    cacheBeta('0.2.0');

    await expect(pinned()).resolves.toMatchObject({ version: '0.4.0-beta.2' });
    expect(beta).toHaveBeenCalledWith('>=0.3.0', dirs.cache);
  });

  // No path yields a production-stamped host: the target is a checkout or a Beta build, and that is what
  // keeps production's data dir and its `apack` keychain entry out of reach
  it('never resolves anything but a checkout or a beta build', async () => {
    for (const target of [await pinned(), await pinned({ flags: { host: 'beta', args: [] } })]) {
      expect(['source', 'packaged']).toContain(target.kind);
      if (target.kind === 'packaged') expect(target.version).toMatch(/beta/);
    }
  });
});

describe('configuredHostPackagesDir', () => {
  const opts = (env: NodeJS.ProcessEnv, checkout?: string) =>
    ({ dirs, env, hostVersion: '>=0.3.0', betaApp: beta, from: tmp, checkout: finds(checkout) });
  const betaPackages = (version: string) =>
    path.join(dirs.cache, 'apps', 'beta', version, 'apack Beta.app', 'Contents', 'Resources', 'app', 'packages');

  it('requires an existing compatible beta for read-only package inspection', async () => {
    const options = { ...opts({ APACK_HOST: 'beta' }), readOnly: true };
    await expect(configuredHostPackagesDir(options)).rejects.toThrow('no compatible cached build');
    expect(beta).not.toHaveBeenCalled();
    expect(fs.existsSync(dirs.cache)).toBe(false);
    cacheBeta('0.4.0-beta.2');
    await expect(configuredHostPackagesDir(options)).resolves.toEqual({
      dir: betaPackages('0.4.0-beta.2'), label: 'apack Beta 0.4.0-beta.2',
    });
    expect(beta).not.toHaveBeenCalled();
  });

  it('uses APACK_HOST, then the checkout behind the pack', async () => {
    const derived = makeCheckout('derived');
    expect((await configuredHostPackagesDir(opts({ APACK_HOST: '/env-root' }, derived)))?.dir).toBe('/env-root/packages');
    expect((await configuredHostPackagesDir(opts({}, derived)))?.dir).toBe(path.join(derived, 'packages'));
  });

  /**
   * The strictness that must *not* be shared with `deriveHost`. A build reads the checkout's `packages/`;
   * refusing it for want of `main/dist` would fail `apack pack build` on a tree that is perfectly readable.
   */
  it('takes an unbuilt checkout, where launching one would refuse it', async () => {
    const raw = makeCheckout('raw-for-build', { built: false });

    expect((await configuredHostPackagesDir(opts({}, raw)))?.dir).toBe(path.join(raw, 'packages'));
  });

  it('downloads the beta for APACK_HOST=beta (CI), ahead of the derived checkout', async () => {
    await expect(configuredHostPackagesDir(opts({ APACK_HOST: 'beta' }))).resolves.toEqual({
      dir: packagedAppPackagesDir(packagedExecutable(path.join(dirs.cache, 'apps', 'beta', '0.4.0-beta.2'))),
      label: 'apack Beta 0.4.0-beta.2',
    });
    expect(beta).toHaveBeenCalledWith('>=0.3.0', dirs.cache);
    // A value that is not a build name is a path, and this resolver validates nothing on purpose: a
    // build reads the checkout's `packages/`, so refusing a tree for want of `main/dist` would refuse
    // one that is perfectly readable
    await expect(configuredHostPackagesDir(opts({ APACK_HOST: '/some-checkout' })))
      .resolves.toMatchObject({ dir: path.join('/some-checkout', 'packages') });
  });

  it('uses the newest downloaded beta the range accepts, and downloads one when none is cached', async () => {
    const asBeta = { APACK_HOST: 'beta' };
    expect((await configuredHostPackagesDir(opts(asBeta)))?.label).toBe('apack Beta 0.4.0-beta.2');
    expect(beta).toHaveBeenCalledTimes(1);

    for (const version of ['0.4.0-beta.9', '0.4.0-beta.10', '0.3.9']) cacheBeta(version);
    fs.mkdirSync(path.join(dirs.cache, 'apps', 'beta', '.0.5.0-beta.0.download-x'));

    await expect(configuredHostPackagesDir(opts(asBeta))).resolves.toEqual({
      dir: betaPackages('0.4.0-beta.10'),
      label: 'apack Beta 0.4.0-beta.10',
    });
    expect(beta).toHaveBeenCalledTimes(1);
  });

  it('reads release layouts from the exact packaged host selected by either input', async () => {
    const bundle = path.join(tmp, 'apack Preview.app');
    const app = path.join(bundle, 'Contents', 'Resources', 'app');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, 'build-manifest.json'), JSON.stringify({ shippedPackLayouts: true }));
    const expected = path.join(app, 'shipped-packs');
    expect((await configuredHostPackagesDir(opts({ APACK_HOST: bundle })))?.dir).toBe(expected);
    expect((await configuredHostPackagesDir(opts({
      APACK_HOST_EXECUTABLE: path.join(bundle, 'Contents', 'MacOS', 'apack Preview'),
    })))?.dir).toBe(expected);
  });

  it('resolves nothing without a configured app', async () => {
    await expect(configuredHostPackagesDir(opts({}))).resolves.toBeNull();
  });

  // An empty APACK_HOST used to swallow the next source and resolve nothing: the lookup read
  // `env.APACK_HOST ?? …`, and '' is not nullish, so it won the `??` and then failed the `if`. The two
  // resolvers beside it had always treated '' as unset.
  it('treats an empty APACK_HOST as unset, as the resolvers do', async () => {
    const derived = makeCheckout('derived');

    expect((await configuredHostPackagesDir(opts({ APACK_HOST: '' }, derived)))?.dir).toBe(path.join(derived, 'packages'));
  });

  // The `null` contract, and what makes the no-unasked-download rule checkable: `fetch-deps` falls through
  // to an installed app, the `.apack` cache and GitHub, none of which this function should pre-empt
  it('resolves nothing, and downloads nothing, with no app named and no checkout behind the pack', async () => {
    await expect(configuredHostPackagesDir(opts({}))).resolves.toBeNull();
    expect(beta).not.toHaveBeenCalled();
  });

  /**
   * The cache is what lets a build resolve built-in dependencies offline, so the range has to be checked
   * here rather than by downloading. It never was, and the newest cached build was used whatever the pack
   * asked for.
   */
  describe('a cached beta, against the range the pack asks for', () => {
    // `APACK_HOST=beta` is how these name a beta now. It was a stored `{ beta: true }` until the choice
    // stopped being stored, and naming it per case is what the stored one was standing in for anyway.
    const asBeta = (hostVersion: string) => ({ dirs, env: { APACK_HOST: 'beta' }, hostVersion, betaApp: beta });

    it('skips a cached build the range excludes, and downloads nothing to do it', async () => {
      cacheBeta('0.5.0-beta.0');
      cacheBeta('0.4.0-beta.10');
      cacheBeta('0.4.0-beta.9');
      await expect(configuredHostPackagesDir(asBeta('^0.4.0-0')))
        .resolves.toMatchObject({ label: 'apack Beta 0.4.0-beta.10' });
      expect(beta, 'the cache is the offline path; checking the range must not cost a download')
        .not.toHaveBeenCalled();
    });

    it('downloads when no cached build satisfies the range', async () => {
      cacheBeta('0.5.0-beta.0');
      await expect(configuredHostPackagesDir(asBeta('^0.4.0-0')))
        .resolves.toMatchObject({ label: 'apack Beta 0.4.0-beta.2' });
      expect(beta).toHaveBeenCalledWith('^0.4.0-0', dirs.cache);
    });

    // A beta promoted from a released commit is tagged v<version>-beta.0 (build/release/beta-tag.sh)
    // while the app inside is <version>, and pickBetaRelease matched the range against the app. Matching
    // the directory name instead would reject this build on every run, for every pack whose floor is a
    // released version — and offline that is a build that fails rather than one that downloads.
    it('matches the app its own version, not the tag the cache directory is named after', async () => {
      cacheBeta('0.4.2-beta.0', '0.4.2');
      await expect(configuredHostPackagesDir(asBeta('>=0.4.2')))
        .resolves.toMatchObject({ label: 'apack Beta 0.4.2-beta.0' });
      expect(beta).not.toHaveBeenCalled();
    });

    // hostVersion defaults to '*', and a prerelease satisfies no range without includePrerelease — '*'
    // included. Dropping that option would empty the cache for every pack that declares no hostVersion.
    it('still accepts a prerelease when the pack declares no hostVersion', async () => {
      cacheBeta('0.4.0-beta.10');
      await expect(configuredHostPackagesDir({ dirs, env: { APACK_HOST: 'beta' }, betaApp: beta }))
        .resolves.toMatchObject({ label: 'apack Beta 0.4.0-beta.10' });
      expect(beta).not.toHaveBeenCalled();
    });
  });
});

/**
 * `APACK_HOST` is read before anything can outrank it, which is what keeps the two resolvers agreeing.
 * It used to be read only where nothing else won, so the same value was an error during `build` and
 * silence during `test` — and a typo was reported or ignored depending on which flag happened to be set.
 *
 * A value that is not a build name is a **path**, so what makes one unusable is naming no checkout — and
 * that is reported by whoever tries to use it, which says more than a parse error could.
 */
describe('an APACK_HOST that names nothing', () => {
  const flags = { args: [] };
  it('is refused by both resolvers', async () => {
    const env = { APACK_HOST: path.join(tmp, 'no-such-checkout') };
    await expect(resolvePackHost({ policy: 'test', flags, hostVersion: '*', dirs, env, betaApp: beta })).rejects.toThrow();
    await expect(deriveHost({ policy: 'development', flags, hostVersion: '*', dirs, env, betaApp: beta, from: tmp, checkout: finds(undefined) }))
      .rejects.toThrow();
  });

  // The flag outranks it, which is the half a reader needs: naming a build on the command line is how you
  // override an inherited one, and that has to work rather than inherit the inherited value's problem
  it('is outranked by the flag, which is what a flag is for', async () => {
    await expect(resolvePackHost({ policy: 'test',
      flags: { host: 'beta', args: [] }, hostVersion: '*', dirs,
      env: { APACK_HOST: path.join(tmp, 'no-such-checkout') }, betaApp: beta,
    })).resolves.toMatchObject({ kind: 'packaged' });
  });
});

describe('fixtureEnv', () => {
  it('points the fixture at exactly one app', () => {
    const base = { APACK_HOST_ROOT: '/stale', APACK_HOST_EXECUTABLE: '/stale-exe', APACK_HOST: 'beta', ELECTRON_RUN_AS_NODE: '1', HOME: '/home' };
    expect(fixtureEnv({ kind: 'packaged', executable: '/fixture/apack.app/Contents/MacOS/apack', version: '1.0.0-beta.0' }, '/pack', base))
      .toEqual({ APACK_HOST_EXECUTABLE: '/fixture/apack.app/Contents/MacOS/apack', PACK_DIR: '/pack', APACK_CLI: cliBin(), ELECTRON_RUN_AS_NODE: '1', HOME: '/home' });
    expect(fixtureEnv({ kind: 'source', root: '/repo' }, undefined, base))
      .toEqual({ APACK_HOST_ROOT: '/repo', APACK_CLI: cliBin(), ELECTRON_RUN_AS_NODE: '1', HOME: '/home' });
    expect(fs.existsSync(cliBin())).toBe(true);
  });

  // The executable says which app to launch; APACK_HOST says which build to resolve dependencies
  // against, and the fixture builds the pack. Without both, `--host beta` builds against whatever
  // checkout the shell happened to name, and against nothing at all in CI.
  it('tells the fixture which build to resolve dependencies against, not just which app to launch', () => {
    expect(fixtureEnv({ kind: 'packaged', executable: '/fixture/apack.app/Contents/MacOS/apack', version: '1.0.0-beta.0' }, '/pack', {})).not.toHaveProperty('APACK_HOST');
    expect(fixtureEnv({ kind: 'source', root: '/repo' }, '/pack', { APACK_HOST: 'beta' })).not.toHaveProperty('APACK_HOST');
  });

  it('asks for a release build only when the caller does', () => {
    const app = { kind: 'source', root: '/repo' } as const;
    expect(fixtureEnv(app, '/pack', {}, { release: true }).APACK_PACK_RELEASE).toBe('1');
    expect(fixtureEnv(app, '/pack', {})).not.toHaveProperty('APACK_PACK_RELEASE');
    expect(fixtureEnv(app, '/pack', { APACK_PACK_RELEASE: '1' })).not.toHaveProperty('APACK_PACK_RELEASE');
  });

  /**
   * `apack pack test` is pinned and hermetic: it reads no machine state. These two reach the fixture straight
   * from the environment, so an exported one sent a test run at a directory the user owns — and the data
   * dir is kept rather than cleaned up, so the run would also leave its writes there.
   *
   * Asserted as the whole environment rather than as two absences, because an absence passes whenever the
   * key is not there: a typo in `base`, or a rename on the fixture's side that this spec and the `delete`
   * both missed, and the leak is back with everything green. The name is hand-written in three places.
   */
  it('decides where the data and screenshots go, whatever the shell says', () => {
    const base = { E2E_DATA_DIR: '/Users/me/the-users-own-data-dir', E2E_SCREENSHOT_DIR: '/elsewhere' };
    expect(fixtureEnv({ kind: 'source', root: '/repo' }, undefined, base))
      .toEqual({ APACK_HOST_ROOT: '/repo', APACK_CLI: cliBin() });
  });

  it('never gives the runner the @apackdev/source condition: a pack resolves the published dist', () => {
    const app = { kind: 'source', root: '/repo' } as const;
    // The caller's own flags survive; the condition does not, however the run was started
    expect(fixtureEnv(app, undefined, { NODE_OPTIONS: '--max-old-space-size=4096' }).NODE_OPTIONS)
      .toBe('--max-old-space-size=4096');
    expect(fixtureEnv(app, undefined, { NODE_OPTIONS: '--conditions=@apackdev/source --max-old-space-size=4096' }).NODE_OPTIONS)
      .toBe('--max-old-space-size=4096');
    expect(fixtureEnv(app, undefined, { NODE_OPTIONS: '--conditions=@apackdev/source' })).not.toHaveProperty('NODE_OPTIONS');
  });
});


describe('repository host validation', () => {
  it('does not replace a missing checkout with a download', () => {
    expect(() => resolveRepositoryHost(tmp)).toThrow('not an apack checkout');
    expect(beta).not.toHaveBeenCalled();
  });
  it('uses the canonical source checkout', () => {
    expect(resolveRepositoryHost(makeCheckout('dev-source'))).toMatchObject({ kind: 'source' });
  });
});
