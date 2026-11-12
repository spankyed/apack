import { fromCallback } from 'xstate';
import { createLogger } from '@apackdev/sdk/logger';
import type { GitRepository, GitWatcherService } from './git/index.ts';

interface GitWatcherSelection {
  watcher: Pick<GitWatcherService, 'setGitRepository' | 'setChangeCallback' | 'startWatching' | 'stopWatching'> | null;
  repository: GitRepository | null;
}

const logger = createLogger('git-watcher');

/** Own watcher handoff and cleanup, including startup still pending when Code stops. */
export const gitWatcherActor = fromCallback<{ type: 'WATCH'; selection: GitWatcherSelection },
  GitWatcherSelection & { onChange: () => void }>(({ input, receive }) => {
  let stopped = false;
  let desired: GitWatcherSelection = input;
  let active: GitWatcherSelection['watcher'] = null;
  let startup: AbortController | undefined;
  let pending = Promise.resolve();
  const report = (error: unknown) => logger.error('Git watcher lifecycle failed', { error });
  const close = () => {
    const watcher = active;
    active = null;
    return watcher?.stopWatching();
  };

  const select = (selection: GitWatcherSelection) => {
    desired = selection;
    startup?.abort();
    const closing = close();
    pending = Promise.all([pending, closing]).then(async () => {
      if (stopped || selection !== desired || !selection.watcher || !selection.repository) return;
      const { watcher, repository } = selection;
      active = watcher;
      watcher.setGitRepository(repository);
      watcher.setChangeCallback((paths) => {
        if (stopped || selection !== desired || active !== watcher) return;
        // Noted before anyone is told, so whoever asks next reads what changed
        repository.noteChanged(paths);
        input.onChange();
      });
      const cancellation = new AbortController();
      startup = cancellation;
      try { await watcher.startWatching(cancellation.signal); }
      catch (error) { active = null; await watcher.stopWatching(); throw error; }
      finally { if (startup === cancellation) startup = undefined; }
    }).catch(report);
  };

  select(input);
  receive(event => select(event.selection));
  return () => {
    stopped = true;
    startup?.abort();
    void Promise.all([pending, close()]).catch(report);
  };
});
