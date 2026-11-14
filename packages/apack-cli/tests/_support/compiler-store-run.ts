// One directory per test run, removed when the run ends, read-only trees included: the workers' compiler stores
// (`compiler-store.ts`) and anything a spec must keep past its own file, such as a cache a worker goes on writing.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { lockIsHeld } from '@apackdev/host/process-liveness';
import { removeCompilerStoreDirectory } from '../../src/build/compiler-installation.ts';

/** `apack-test-run-<pid>-<suffix>`: the pid is the run that owns it, which is how a later run tells it abandoned */
const RUN_DIRECTORY = /^apack-test-run-(\d+)-[^-]+$/;

export default async function setup(): Promise<() => Promise<void>> {
  // Keep immutable runtime copies off bounded RAM scratch. This checkout owns the run directory, and normal
  // teardown removes it.
  const parent = path.join(REPO_ROOT, '.temp');
  fs.mkdirSync(parent, { recursive: true });
  // **A run that was interrupted never reaches its teardown**, and its directory holds a compiler store per worker —
  // gigabytes, accumulating with every Ctrl-C. So each run removes the ones whose process has exited. `lockIsHeld`
  // errs toward a live owner, so a run still going is never removed from under it
  await Promise.all(fs.readdirSync(parent).map(async (name) => {
    const pid = RUN_DIRECTORY.exec(name)?.[1];
    if (pid === undefined || lockIsHeld(Number(pid))) return;
    await removeCompilerStoreDirectory(path.join(parent, name)).catch(() => {
      // Another run removing it too, or one this user cannot remove; the next run tries again
    });
  }));
  const root = fs.mkdtempSync(path.join(parent, `apack-test-run-${process.pid}-`));
  process.env.APACK_TEST_RUN_DIRECTORY = root;
  return () => removeCompilerStoreDirectory(root);
}
