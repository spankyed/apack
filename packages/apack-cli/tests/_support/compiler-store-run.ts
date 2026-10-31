// One directory per test run, removed when the run ends, read-only trees included: the workers' compiler stores
// (`compiler-store.ts`) and anything a spec must keep past its own file, such as a cache a worker goes on writing.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { removeCompilerStoreDirectory } from '../../src/build/compiler-installation.ts';

export default function setup(): () => Promise<void> {
  // Keep immutable runtime copies off bounded RAM scratch. This checkout owns the run directory;
  // normal teardown removes it, and the Linux runner's exclusive source sync removes interrupted runs.
  const parent = path.join(REPO_ROOT, '.temp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'apack-test-run-'));
  process.env.APACK_TEST_RUN_DIRECTORY = root;
  return () => removeCompilerStoreDirectory(root);
}
