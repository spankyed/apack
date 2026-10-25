// A pack's vitest config, and the isolated data dir under it.
//
//   import { definePackTestConfig } from '@apackdev/testing/vitest';
//   export default definePackTestConfig();
//
// `isolatedDataDir` is the half a pack used to assemble by hand; it is still exported for a pack that needs
// a config `definePackTestConfig` cannot express.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ViteUserConfig } from 'vitest/config';

export interface IsolatedDataDir {
  /** The run's data dir; each worker uses a `worker-<n>` subdir of it */
  dir: string;
  /** `test.env`: the test environment and the run's data dir */
  env: { APACK_ENV: 'test'; APACK_USER_DATA_DIR: string };
  /** `test.globalSetup`: removes the run's data dir when the run ends */
  globalSetup: string[];
  /**
   * `test.setupFiles`, first: ends a worker whose vitest is gone, and points the worker at its own subdir before
   * anything opens a store
   */
  setupFiles: string[];
}


/** A sibling module of this one, with this module's extension (source .ts, or the bundle's .js) */
function sibling(name: string): string {
  const self = fileURLToPath(import.meta.url);
  return path.join(path.dirname(self), `${name}${path.extname(self)}`);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Removes data dirs with this prefix left by runs that crashed before their teardown. A run's dir
 * is named after its process, so only dirs of processes that are gone are removed.
 */
function removeStaleDirs(prefix: string): void {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}(\\d+)-[A-Za-z0-9]{6}$`);
  let names: string[];
  try {
    names = fs.readdirSync(os.tmpdir());
  } catch {
    return;
  }
  for (const name of names) {
    const pid = pattern.exec(name)?.[1];
    if (!pid || isRunning(Number(pid))) continue;
    try {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    } catch {
      // Another run's leftovers: not this run's concern
    }
  }
}

/** Creates the run's data dir and the vitest settings that isolate and clean it up */
export function isolatedDataDir(prefix = 'apack-tests-'): IsolatedDataDir {
  removeStaleDirs(prefix);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}${process.pid}-`));
  return {
    dir,
    env: { APACK_ENV: 'test', APACK_USER_DATA_DIR: dir },
    globalSetup: [sibling('vitest-teardown')],
    setupFiles: [sibling('vitest-exit-with-parent'), sibling('vitest-worker')],
  };
}

/**
 * What a pack's SFCs become in its tests, and why they are not compiled.
 *
 * A pack's specs drive machines, systems, content and repositories; **one spec in the whole apack repo
 * mounts a Vue component**. What every pack needs instead is a module graph that *resolves*, because
 * `vitest related` and `--changed` walk it from the file you edited — and without this they die on the first
 * `.vue` they reach, which is any pack with a surface.
 *
 * This is the third place the toolchain answers that question the same way, so it is the convention rather
 * than a shortcut: `apack pack init`'s `env.d.ts` declares `*.vue` as a generic component for `tsc` (*"Plain
 * `tsc` can't read .vue files"*), and `apack pack build` stubs `.vue` and `.css` for the backend bundle (*"The
 * backend runtime never renders them"*). A stubbed SFC is also never *parsed*, which is why a pack's own path
 * aliases need no handling here: nothing inside one is resolved.
 *
 * It throws when rendered rather than returning an empty component, because a component test that silently
 * asserts against nothing is worse than one that fails.
 */
const STUBBED_SFC = `export default {
  name: 'ApackStubbedSfc',
  render() {
    throw new Error(
      'This pack\\'s test config stubs .vue files, so components are not compiled or rendered. To render '
      + 'them, install @vitejs/plugin-vue and pass { vue: true } to definePackTestConfig().',
    );
  },
};
`;

/**
 * `enforce: 'pre'` with `load` rather than `resolveId`, measured: Vite's own resolver wins the id, so a
 * `resolveId` hook at normal order never sees `./form.vue` and `load` then gets an absolute path that the
 * real file is read from. Matching the id in `load` works however it was resolved.
 */
const stubSfcPlugin = (): NonNullable<ViteUserConfig['plugins']>[number] => ({
  name: 'apack-stub-sfc',
  enforce: 'pre',
  load: (id: string) => (id.split('?')[0]!.endsWith('.vue') ? STUBBED_SFC : null),
});

/** The real compiler, for a pack that renders. An optional peer, so a pack that does not need it installs nothing. */
async function vueSfcPlugin(): Promise<NonNullable<ViteUserConfig['plugins']>[number]> {
  try {
    const { default: vue } = await import('@vitejs/plugin-vue');
    return vue();
  } catch (err) {
    throw new Error('definePackTestConfig({ vue: true }) compiles this pack\'s .vue files and needs '
      + `@vitejs/plugin-vue, which could not be loaded: ${(err as Error).message}\n`
      + 'Install it in the pack (npm i -D @vitejs/plugin-vue), or drop `vue: true` to stub SFCs instead.');
  }
}

export interface PackTestConfig {
  /** Prefix for the run's throwaway data dir, so leftovers name the suite that made them */
  readonly dataDirPrefix?: string;
  /** Globs to leave out beyond `tests/e2e/**` and `tests/_support/**`, which are excluded already */
  readonly exclude?: readonly string[];
  /** Plugins this pack needs on top of the SFC handling */
  readonly plugins?: NonNullable<ViteUserConfig['plugins']>;
  /** Setup files after the data dir's own, which must come first. Defaults to the pack's `tests/setup.ts` */
  readonly setupFiles?: readonly string[];
  /** Compile the pack's SFCs instead of stubbing them; needs `@vitejs/plugin-vue` installed */
  readonly vue?: boolean;
}

/**
 * A pack's vitest config.
 *
 * It exists because there were three of these and they had drifted: the built-in pack, the repo's fixture
 * pack and the config `apack pack init` scaffolds each restated the same settings, and one of them ran without
 * `globals` while another set it. Nobody decided that; it is what three copies do.
 *
 * **No `resolve.conditions`, ever.** A pack resolves the `@apackdev` packages' published `dist`, which is the
 * one layout a pack author has, and `check:specifiers` refuses a pack config that declares the source
 * condition. A helper that quietly declared it would break that for every pack at once.
 */
export async function definePackTestConfig(options: PackTestConfig = {}): Promise<ViteUserConfig> {
  const dataDir = isolatedDataDir(options.dataDirPrefix);
  return {
    // Test caches must not create a dependency namespace after a pack records its build inputs.
    cacheDir: '.apack/tests/vite',
    plugins: [options.vue === true ? await vueSfcPlugin() : stubSfcPlugin(), ...(options.plugins ?? [])],
    test: {
      globals: true,
      environment: 'node',
      // A spec's path mirrors the source it covers, so one pattern finds every one of them
      include: ['tests/**/*.spec.ts'],
      // `tests/e2e/` is Playwright's, run by `apack pack test` — a different runner, not a cost half. `_support/`
      // is helpers and fixture packs: a fixture that grew a spec would otherwise join this suite.
      exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', 'tests/_support/**', ...(options.exclude ?? [])],
      // Small (`SIZE_MS` × `DEADLINE_FACTOR`, scripts/lib/unit-suites.ts): a unit test that takes longer is hung, not
      // slow. Vitest's own default is 5s for a test and 10s for a hook, both tighter than the size allows.
      testTimeout: 30_000,
      hookTimeout: 30_000,
      // Each worker's tests create their own EARS engines, so files may run in parallel
      fileParallelism: true,
      env: dataDir.env,
      globalSetup: dataDir.globalSetup,
      // The data dir's setup files come first: they end an orphaned worker and point it at its own subdir
      setupFiles: [...dataDir.setupFiles, ...(options.setupFiles ?? ['./tests/setup.ts'])],
    },
  };
}
