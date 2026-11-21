import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { freshnessSweep, INPUTS_CHANGED, stampedRun, unitStaleReason, type BuildUnit } from '@apackdev/host/build/packages-built';

/**
 * `freshnessSweep`'s `forget`: beside `package-freshness.spec.ts`, which covers the rest of the same module.
 *
 * It was in `@app/internal-repo-checks` while it also held the chain's one transient writer to its mutex. Nothing
 * writes transiently now (`conflictsOf`'s comment says what that would need), and what is left is a claim
 * about a host function — so it sits where that function's other spec does, which is also where
 * `npm run spec` routes a change to it.
 *
 * The chain's dispatch decisions share one reading of the tree, and `forget` is the whole reason they can.
 *
 * A shared reading answers as of its first look, so a step whose inputs another step has just written would
 * be called fresh and skipped — work silently not done, reported green. What makes it sound is that the
 * writer is always known: every step declares what it writes, the chain forgets exactly those paths as each
 * step finishes, and the next decision re-reads them.
 *
 * So what has to hold is that `forget` actually forgets — by prefix, since what is memoised are the files
 * under a declared directory and the listing of it, not the directory key. Every write the chain has is a
 * declared product, and a reader of one is ordered after its writer by `dependsOn`, derived from that same
 * declaration; nothing writes transiently where another step reads (`conflictsOf`'s comment has what that
 * would need).
 */
const dirs: string[] = [];
const tempTree = (content: string): { root: string; unit: BuildUnit; stamp: string } => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-forget-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, 'in', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'in', 'nested', 'a.ts'), content);
  return { root, unit: { inputs: [path.join(root, 'in')], outputs: [], excludes: [] }, stamp: path.join(root, 'stamp.json') };
};
const rewrite = (root: string, content: string): void =>
  fs.writeFileSync(path.join(root, 'in', 'nested', 'a.ts'), content);
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('a shared reading forgets what a step writes', () => {
  /**
   * A real stamp over a real tree, which is what makes these cases mean anything: without one every
   * answer is "no stamp", and comparing that to itself passes whatever `forget` does.
   */
  const recorded = async (content: string) => {
    const tree = tempTree(content);
    await stampedRun('probe', tree.unit, tree.stamp, () => {});
    expect(unitStaleReason(tree.unit, tree.stamp), 'the stamp does not match the tree it was taken over')
      .toBeNull();
    return tree;
  };

  it('holds its first reading after the tree moves, which is the hazard', async () => {
    const { root, unit, stamp } = await recorded('first');
    const sweep = freshnessSweep();
    expect(sweep.staleReason(unit, stamp), 'fresh before the write').toBeNull();

    rewrite(root, 'second');
    expect(unitStaleReason(unit, stamp), 'a reading of its own would see the write').toBe(INPUTS_CHANGED);
    expect(sweep.staleReason(unit, stamp), 'a sweep that re-read the tree would not be a sweep').toBeNull();
  });

  it('answers as a fresh reading does once it has forgotten the path', async () => {
    const { root, unit, stamp } = await recorded('first');
    const sweep = freshnessSweep();
    sweep.staleReason(unit, stamp);
    rewrite(root, 'second');

    sweep.forget([path.join(root, 'in')]);
    expect(sweep.staleReason(unit, stamp), 'after forgetting, the write must be visible').toBe(INPUTS_CHANGED);
  });

  /**
   * By prefix, which is the part that is easy to get wrong: what a sweep memoises are the files under a
   * declared directory and the listing of it, so forgetting only the key it was handed leaves every file
   * inside it stale in the maps. The file here is two levels down for exactly that reason.
   */
  it('forgets the files under the path, not only the path', async () => {
    const { root, unit, stamp } = await recorded('first');
    const sweep = freshnessSweep();
    sweep.staleReason(unit, stamp);
    rewrite(root, 'second');

    sweep.forget([root]);
    expect(sweep.staleReason(unit, stamp), 'a file two levels down survived a forget of the root')
      .toBe(INPUTS_CHANGED);
  });

  // A path the sweep never read is not one it has to forget
  it('leaves alone what it was not asked about', () => {
    expect(() => freshnessSweep().forget(['/nowhere/at/all'])).not.toThrow();
  });
});
