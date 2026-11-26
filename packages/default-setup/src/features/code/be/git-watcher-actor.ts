import { given, state } from '@apackdev/state';
import { createLogger } from '@apackdev/sdk/logger';
import type { GitRepository, GitWatcherService } from '@apackdev/git';

export interface GitWatcherSelection {
  watcher: Pick<GitWatcherService, 'setGitRepository' | 'setChangeCallback' | 'startWatching' | 'stopWatching'> | null;
  repository: GitRepository | null;
}

export type GitWatcherEvent = { type: 'WATCH'; selection: GitWatcherSelection };
export type GitWatcherReport = { type: 'GIT_WATCHER_CHANGED' };

const logger = createLogger('git-watcher');

/** Owns watcher handoff and cleanup, including startup still pending when Code stops. */
class GitWatcherController {
  private stopped = false;
  private desired: GitWatcherSelection = { watcher: null, repository: null };
  private active: GitWatcherSelection['watcher'] = null;
  private startup: AbortController | undefined;
  private pending = Promise.resolve();

  constructor(private readonly onChange: () => void) {}

  private readonly reportError = (error: unknown) => logger.error('Git watcher lifecycle failed', { error });

  private close() {
    const watcher = this.active;
    this.active = null;
    return watcher?.stopWatching();
  }

  select(selection: GitWatcherSelection): void {
    this.desired = selection;
    this.startup?.abort();
    const closing = this.close();
    this.pending = Promise.all([this.pending, closing]).then(async () => {
      if (this.stopped || selection !== this.desired || !selection.watcher || !selection.repository) return;
      const { watcher, repository } = selection;
      this.active = watcher;
      watcher.setGitRepository(repository);
      watcher.setChangeCallback((paths) => {
        if (this.stopped || selection !== this.desired || this.active !== watcher) return;
        // Noted before anyone is told, so whoever asks next reads what changed
        repository.noteChanged(paths);
        this.onChange();
      });
      const cancellation = new AbortController();
      this.startup = cancellation;
      try {
        await watcher.startWatching(cancellation.signal);
      } catch (error) {
        this.active = null;
        await watcher.stopWatching();
        throw error;
      } finally {
        if (this.startup === cancellation) this.startup = undefined;
      }
    }).catch(this.reportError);
  }

  stop(): void {
    this.stopped = true;
    this.startup?.abort();
    void Promise.all([this.pending, this.close()]).catch(this.reportError);
  }
}

type GitWatcherShape = {
  data: {
    selection: GitWatcherSelection;
    controller: GitWatcherController | null;
  };
  internal: { type: 'ATTACH'; controller: GitWatcherController };
  reports: GitWatcherReport;
};

/** Own watcher handoff and cleanup, including startup still pending when Code stops. */
export const gitWatcherState = state<GitWatcherShape, GitWatcherEvent>()({
  data: {
    selection: given,
    controller: null,
  },
  listen: ({ data, send, report }) => {
    const controller = new GitWatcherController(() => report({ type: 'GIT_WATCHER_CHANGED' }));
    controller.select(data.selection as GitWatcherSelection);
    send({ type: 'ATTACH', controller });
    return () => controller.stop();
  },
  internal: {
    ATTACH: ({ controller }) => ({ data: { controller } }),
  },
  on: {
    WATCH: ({ selection }, { data }) => {
      data.controller?.select(selection);
      return { data: { selection } };
    },
  },
});
