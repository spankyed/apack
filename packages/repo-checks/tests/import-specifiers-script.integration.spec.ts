import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { CHECKS } from '../../../scripts/check-import-specifiers.ts';
import { execFileWhileWorking } from '@apackdev/host/build/process-progress';

const execFileAsync = execFileWhileWorking;

/**
 * The one check on `scripts/check-import-specifiers.ts` that runs it as a process. Every other test of it
 * calls its exported checks in-process and lives in `import-specifiers.integration.spec.ts` — which is also
 * in this half, because at 6.4s it costs more than this one does. Spawning stopped deciding the split.
 */
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-specifiers-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('check-import-specifiers as a script', () => {
  it('runs as a script through a symlinked path', async () => {
    const link = path.join(root, 'check.ts');
    fs.symlinkSync(path.join(REPO_ROOT, 'scripts', 'check-import-specifiers.ts'), link);
    const { stdout: output } = await execFileAsync(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), [link],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    expect(output).toMatch(/Import specifiers and pack rules pass/);
    // It checks the whole repo, parsing every file
  });

  /**
   * `--list` as a process: that the flag is wired, and that the table it prints is over the rule set the runner
   * uses. What each row *says* is asserted in-process and per row in `import-specifiers.integration.spec.ts` —
   * over the rows as data, because every rule's key appears somewhere in this output whatever it is paired with,
   * so a table rendered one row out reads as correct from here.
   */
  it('prints the rule table over every rule', async () => {
    const { stdout: list } = await execFileAsync(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'),
      [path.join(REPO_ROOT, 'scripts', 'check-import-specifiers.ts'), '--list'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });

    expect(CHECKS.length, 'no rules, so this would pass over nothing').toBeGreaterThan(0);
    expect(list).toMatch(/^rule\s+paths\?\s+a pack too\?\s+what it reports$/m);
    expect(list, 'the second table counts a different rule set than the runner has')
      .toMatch(new RegExp(`\\d+ of ${CHECKS.length} are this repo's alone`));
  });
});
