// What `repoFiles()` owes the six checks that build their populations from it, and did not owe when they each
// called `git ls-files` themselves: every path it hands back is a file that is there.
//
// This is the case that was missing when the original bug shipped. Four checks read what the walk returned and
// died with ENOENT on a spec deleted from the worktree and not yet staged, because the index still held it.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { repoFiles } from './_support/repo-files.ts';

describe('repoFiles', () => {
  /**
   * The refusal, which is what the six checks built on this get for free.
   *
   * Each of them asserts that a *derived* set is empty — no spec outside this package imports repo tooling,
   * no tracked file names a platform data dir — and that shape passes for nothing when the population it
   * filtered was empty. The guard lives in `repoFiles` rather than in each caller, so this is the case that
   * holds it: a pattern matching no file is a failure with a name, not six green checks over nothing.
   */
  it('refuses a population with nothing in it, rather than handing back none', () => {
    expect(() => repoFiles('*.not-an-extension-this-repo-has'))
      .toThrow(/passed? for the wrong reason|wrong reason/);
  });

  it('is not empty, so everything below is about something', () => {
    expect(repoFiles().length).toBeGreaterThan(100);
  });

  // The invariant. It fails the moment the existsSync filter is dropped and a deletion is left unstaged, which
  // is the state the four crashes were reported from
  it('hands back only files that are on disk', () => {
    const missing = repoFiles().filter((file) => !fs.existsSync(path.join(REPO_ROOT, file)));

    expect(missing, 'these are in git or untracked but not on disk; a caller that reads one throws ENOENT')
      .toEqual([]);
  });

  it('narrows to a pattern, which is how two of its callers ask', () => {
    const markdown = repoFiles('*.md');

    expect(markdown.length).toBeGreaterThan(10);
    expect(markdown.filter((file) => !file.endsWith('.md'))).toEqual([]);
  });

  /**
   * The other half of the question, and the reason this asks `-co` rather than the index alone: a file you have
   * just written is one the placement, import, cost and table checks should already be talking about.
   *
   * Asserted against this package's own tests rather than a fixture, because creating an untracked file to prove
   * it would be creating exactly the state the assertion is about — in a tree another session commits to.
   */
  it('asks the working tree, not the index', () => {
    const args = fs.readFileSync(path.join(REPO_ROOT, 'packages/repo-checks/tests/_support/repo-files.ts'), 'utf-8');

    expect(args, 'without -co an untracked file is invisible to every check built on this').toContain("'-co'");
    expect(args, "without --exclude-standard a gitignored file is visible, and node_modules with it")
      .toContain("'--exclude-standard'");
  });
});
