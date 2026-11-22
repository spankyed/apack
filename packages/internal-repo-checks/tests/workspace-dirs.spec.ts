import { describe, expect, it } from 'vitest';
import { PACKAGE_DIRS, workspaceDirsFrom } from '../../../scripts/lib/workspace-deps.ts';

/**
 * What "the workspaces" means, and what happens to a glob that does not fit it.
 *
 * `PACKAGE_DIRS` is the one definition — `chain-steps.ts` turns it into every step's inputs, and four specs
 * read it — and it refuses a `workspaces` entry whose workspaces it could not name, because the alternative
 * is dropping them and reporting green over the difference. That refusal runs at module load of something
 * both `npm run chain` and `npm run spec` import, so it can only be watched failing from a pure function,
 * which is why `workspaceDirsFrom` is one.
 */
describe('the workspaces are what the root manifest says they are', () => {
  it('names every packages/* holding a manifest', () => {
    const dirs = workspaceDirsFrom(['packages/*']);
    expect(dirs.length, 'no workspace was derived, so the cases below would prove nothing').toBeGreaterThan(10);
    expect(dirs).toEqual([...dirs].sort());
    expect(dirs, 'the pure function and the constant the repo reads must agree').toEqual([...PACKAGE_DIRS]);
  });

  // The refusal these exist for: a glob outside packages/ has workspaces this cannot name, and the failure
  // mode without it is silence — a workspace missing from every consumer, including the chain's cache keys
  it('refuses a glob whose workspaces it could not name, saying what to change', () => {
    expect(() => workspaceDirsFrom(['packages/*', 'tests/packs/*']))
      .toThrow(/only reads the glob `packages\/\*`.*tests\/packs\/\*.*dropped silently/s);
  });

  it('refuses an empty field rather than deriving nothing', () => {
    expect(() => workspaceDirsFrom([])).toThrow(/declares no workspaces/);
  });
});
