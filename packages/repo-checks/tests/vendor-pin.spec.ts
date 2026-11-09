// What the linkers say about a vendored checkout's pin, driven without a repository.
//
// Both things reported here cost something somewhere else and nothing where they are caused, which is why
// each has a case rather than a reading of the live checkout: a pin that happens to be pushed and a checkout
// that happens to sit on it would make every one of these pass by saying nothing. `pinWarnings` takes its
// git as an argument for exactly that reason.
import { describe, expect, it } from 'vitest';
import { pinWarnings } from '../../../scripts/lib/vendor-pin.mjs';

const PIN = 'a'.repeat(40);
const AHEAD = 'b'.repeat(40);

/**
 * git, answering from a table, recording what it was asked.
 *
 * A key it has no answer for throws, as git does for a question it refuses — which is the shape the
 * unreachable-remote and no-such-commit paths both arrive as.
 */
function fakeGit(answers: Record<string, string>) {
  const asked: string[] = [];
  const run = (args: string[]) => {
    const key = args.join(' ');
    asked.push(key);
    if (!(key in answers)) throw new Error(`git refused: ${key}`);
    return answers[key]!;
  };
  return { run, asked };
}

const warn = (answers: Record<string, string>) => {
  const { run, asked } = fakeGit(answers);
  return { warnings: pinWarnings({ name: 'elmdb', rev: PIN, checkout: '/checkout', run }), asked };
};

/** A checkout sitting on the pin, with the pin on a branch of the remote */
const HEALTHY = {
  'rev-parse HEAD': PIN,
  [`branch -r --contains ${PIN}`]: '  origin/master\n  origin/HEAD -> origin/master',
};

describe('what a vendored pin is worth saying about', () => {
  it('says nothing when the checkout is on the pin and the pin is pushed', () => {
    expect(warn(HEALTHY).warnings).toEqual([]);
  });

  it('asks the network only when the refs it already has do not answer', () => {
    // The healthy path is every run on a machine someone works on, so it must not pay for a fetch: the
    // remote-tracking refs already answer it. (`origin/HEAD` is filtered as a symbolic ref rather than a
    // branch holding anything, which is tidiness and not a guard — an unpushed commit is on no remote ref
    // at all, so nothing is listed for it either way.)
    expect(warn(HEALTHY).asked).not.toContain('fetch origin --quiet');
  });

  it('reports a checkout that has drifted past the pin, and how far', () => {
    const { warnings } = warn({
      'rev-parse HEAD': AHEAD,
      [`rev-list --count ${PIN}..HEAD`]: '3',
      [`branch -r --contains ${PIN}`]: '  origin/master',
    });

    expect(warnings).toHaveLength(1);
    // A local run builds the checkout and CI clones the pin, so the number is the point: it says how much
    // code the two runs disagree about
    expect(warnings[0]).toContain('3 commits past');
    expect(warnings[0]).toContain(AHEAD.slice(0, 12));
    expect(warnings[0]).toContain(PIN.slice(0, 12));
    expect(warnings[0], 'the way out is named, since the right one depends on which is wrong')
      .toMatch(/checkout aaaaaaaaaaaa|bump vendor\/elmdb\.rev/);
  });

  it('counts one commit as one', () => {
    const { warnings } = warn({
      'rev-parse HEAD': AHEAD,
      [`rev-list --count ${PIN}..HEAD`]: '1',
      [`branch -r --contains ${PIN}`]: '  origin/master',
    });

    expect(warnings[0]).toContain('1 commit past');
  });

  it('reports a pin that is on no branch of the remote', () => {
    const { warnings, asked } = warn({
      'rev-parse HEAD': PIN,
      [`branch -r --contains ${PIN}`]: '',
      'fetch origin --quiet': '',
    });

    // Fetched first, because remote-tracking refs go stale and the answer is worthless if it is yesterday's
    expect(asked).toContain('fetch origin --quiet');
    expect(warnings).toHaveLength(1);
    expect(warnings[0], 'CI clones at the pin, so this is where an unpushed one is survivable')
      .toContain('on no branch of origin');
  });

  it('says it cannot tell when the remote is unreachable, rather than either answer', () => {
    // No `fetch` entry, so the fake throws for it as git does offline. Reporting "unpushed" here would send
    // someone to push a commit that is already pushed; reporting nothing would hide a real one
    const { warnings } = warn({ 'rev-parse HEAD': PIN, [`branch -r --contains ${PIN}`]: '' });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Could not reach origin');
    expect(warnings[0]).toContain('unknown');
  });

  it('reports both when both are true', () => {
    const { warnings } = warn({
      'rev-parse HEAD': AHEAD,
      [`rev-list --count ${PIN}..HEAD`]: '2',
      [`branch -r --contains ${PIN}`]: '',
      'fetch origin --quiet': '',
    });

    expect(warnings).toHaveLength(2);
    expect(warnings.join('\n')).toContain('2 commits past');
    expect(warnings.join('\n')).toContain('on no branch of origin');
  });

  it('says the checkout is not at the pin when the two histories do not meet', () => {
    // `rev-list` refuses for commits with no common ancestor, which is a checkout of the wrong repository
    // rather than one that has moved on — so there is no count to give, and it must still say so
    const { warnings } = warn({
      'rev-parse HEAD': AHEAD,
      [`branch -r --contains ${PIN}`]: '  origin/master',
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('not at the pinned');
  });
});
