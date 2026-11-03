import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyDefaultPackFork } from './prepare-default-pack-fork.ts';
import { fixtureEnv } from '../../../packages/apack-cli/src/commands/test.ts';
import { resolvePlaywrightCli } from '../../../packages/apack-cli/src/app/playwright.ts';

// Native realpath restores on-disk casing; JS realpath preserves case aliases on macOS.
const root = fs.realpathSync.native(fileURLToPath(new URL('../../..', import.meta.url)));
const pack = path.join(root, 'tests', 'packs', 'external-pack');
verifyDefaultPackFork();
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-fork-restart-'));
const run = promisify(execFile);
try {
  const playwright = resolvePlaywrightCli(pack);
  const launch = async (phase?: 'fork' | 'removed' | 'restored') => {
    const env = { ...fixtureEnv({ kind: 'source', root }, phase === 'removed' || phase === 'restored' ? undefined : pack,
      process.env, { prebuilt: true }), E2E_DATA_DIR: data,
      APACK_KEEP_FORK: phase ? '' : '1', APACK_FORK_BOOT_CHECK: phase ?? '',
    };
    // Its own output directory: the fixture packs' suites run beside this one in the same pack directory, and
    // Playwright clears its output directory as it starts
    const result = await run(process.execPath, [playwright, 'test', '-g', phase ? 'default lifecycle survives normal boot' : 'externally built default fork',
      '--output', path.join(pack, '.apack', 'tests', 'fork-results')],
      { cwd: pack, env, maxBuffer: 16 * 1024 * 1024 });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  };
  const mutate = async (args: string[]) => {
    const result = await run(process.execPath, [path.join(root, 'node_modules', '.bin', 'apack'), 'pack', ...args], {
      cwd: pack, env: { ...process.env, APACK_USER_DATA_DIR: data, APACK_CLI_CHANNEL: 'test' },
      maxBuffer: 16 * 1024 * 1024,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  };
  await launch();
  await launch('fork');
  await mutate(['restore', 'default-setup', '--host', root]);
  await mutate(['uninstall', 'default-setup']);
  // This fixture consumes default-setup. Host-only absence must not weaken its required dependencies.
  await mutate(['uninstall', 'e2e-fixture']);
  await launch('removed');
  await mutate(['restore', 'default-setup', '--host', root]);
  await launch('restored');

} catch (error) {
  const failed = error as Error & { stdout?: string; stderr?: string };
  if (failed.stdout) process.stdout.write(failed.stdout);
  if (failed.stderr) process.stderr.write(failed.stderr);
  throw error;
} finally {
  fs.rmSync(data, { recursive: true, force: true });
}
