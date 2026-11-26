// A watch can be open and still not deliver, as on a network drive or past the system's limit on watches: the
// engine finds changes it never reported and says so in the status. The commit panel holds that for as long as
// the statuses it is sent say it, beside a watch that could not be opened at all.
import { afterEach, expect, it } from 'vitest';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

async function report(h: CommitHarness, { watching, watchSilent }: { watching: boolean; watchSilent?: boolean }) {
  h.send({ type: 'commit.REFRESH_STATUS' });
  await h.latestAsk('commit.GET_GIT_STATUS').answer({
    files: [], truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching, ...(watchSilent && { watchSilent }),
  });
}

it('holds a silent watch while the statuses say it, and lets it go once one does not', async () => {
  const h = startCommit();
  running.push(h);

  await report(h, { watching: true, watchSilent: true });
  expect(h.open().data).toMatchObject({ isWatchingRepository: true, isWatchSilent: true });

  await report(h, { watching: true });
  expect(h.open().data.isWatchSilent).toBe(false);
});

it('keeps a watch that could not be opened apart from one that is not delivering', async () => {
  const h = startCommit();
  running.push(h);

  await report(h, { watching: false });

  expect(h.open().data).toMatchObject({ isWatchingRepository: false, isWatchSilent: false });
});
