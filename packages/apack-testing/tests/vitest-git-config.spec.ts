// Git run from a test reads none of the machine's config (`src/vitest-git-config.ts`, which this package's config
// loads as every config does). The machine's config is planted where git looks for it — a home, an XDG config dir,
// a system file — so the case holds on a machine that has none of its own.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-git-config-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const home = path.join(dir, 'home');
const xdg = path.join(dir, 'xdg');
const system = path.join(dir, 'gitconfig');
fs.mkdirSync(path.join(xdg, 'git'), { recursive: true });
fs.mkdirSync(home);
fs.writeFileSync(path.join(home, '.gitconfig'), '[apack]\n\thome = planted\n');
fs.writeFileSync(path.join(xdg, 'git', 'config'), '[apack]\n\txdg = planted\n');
fs.writeFileSync(system, '[apack]\n\tsystem = planted\n');

/** What git reads for `apack.*` from outside any repository, under the worker's environment with `overrides` over it */
async function plantedKeys(overrides: NodeJS.ProcessEnv): Promise<string[]> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, XDG_CONFIG_HOME: xdg, GIT_CONFIG_SYSTEM: system, ...overrides };
  for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];
  try {
    const { stdout } = await execFileWhileWorking('git', ['config', '--get-regexp', '^apack\\.'], { cwd: dir, env });
    return stdout.trim().split('\n').map((line) => line.split(' ')[0]!).sort();
  } catch (error) {
    // `git config --get-regexp` exits 1 for no match
    if ((error as { code?: number }).code === 1) return [];
    throw error;
  }
}

it('reads no user or system config', async () => {
  expect(await plantedKeys({})).toEqual([]);
});

// What the case above would also say if the plant were in the wrong places: the same git, given the levels back, reads all three
it('reads all three once the levels are given back', async () => {
  expect(await plantedKeys({ GIT_CONFIG_GLOBAL: undefined, GIT_CONFIG_NOSYSTEM: undefined }))
    .toEqual(['apack.home', 'apack.system', 'apack.xdg']);
});
