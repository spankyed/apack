import type {LogsSurfaceState} from '../../agentbuddy-ui/logs/logTypes';
import {launchFilmStory} from './launchStory';
import {revealText} from './typing';

const now = Date.parse('2026-05-25T14:35:16Z');

export const logsSurfaceState: LogsSurfaceState = {
  copied: false,
  expandedContent: {
    'log-release-run': 'meta',
    'log-render-error': 'stack',
  },
  filterLevel: 'all',
  logs: [
    {
      id: 'log-release-run',
      level: 'info',
      message: 'Deploy checkout workflow started for Supafan',
      meta: {
        flowId: launchFilmStory.flow.id,
        branch: launchFilmStory.branch,
        steps: ['run database migrations', 'deploy checkout workers', 'notify releases channel'],
      },
      source: 'flows',
      timestamp: now,
    },
    {
      id: 'log-query',
      level: 'debug',
      message: 'Database query completed in 42.18ms',
      meta: {
        entity: 'Thread',
        count: 4,
        selector: "where('status', 'active')",
      },
      source: 'database',
      timestamp: now - 8_000,
    },
    {
      id: 'log-actions',
      level: 'info',
      message: 'Action template "Deploy checkout" saved',
      source: 'actions',
      timestamp: now - 19_000,
    },
    {
      id: 'log-render-warning',
      level: 'warn',
      message: 'Render cache was rebuilt after stale webpack pack was detected',
      meta: {
        cache: 'remotion-production',
        recovered: true,
      },
      source: 'video',
      timestamp: now - 28_000,
    },
    {
      id: 'log-render-error',
      level: 'error',
      message: 'Failed to publish draft asset on first attempt',
      source: 'publisher',
      stack: `Error: Upload failed with status 503
at publishAsset (publisher.ts:88:11)
at async runReleaseWorkflow (release.ts:141:5)
at async executeFlow (flows.ts:220:3)`,
      timestamp: now - 37_000,
    },
    {
      id: 'log-app-event',
      level: 'debug',
      message: 'Plugin selected: logs',
      source: 'app-events',
      timestamp: now - 51_000,
    },
  ],
  searchTerm: '',
  settings: {
    excludedSources: ['debug:verbose'],
    maxLogs: 1000,
    showAppEvents: true,
  },
};

export const logsFilteredState: LogsSurfaceState = {
  ...logsSurfaceState,
  expandedContent: {},
  filterLevel: 'error',
  searchTerm: 'publish',
};

export const logsEmptyState: LogsSurfaceState = {
  ...logsSurfaceState,
  expandedContent: {},
  filterLevel: 'all',
  logs: [],
  searchTerm: '',
  settings: {
    excludedSources: [],
    maxLogs: 1000,
    showAppEvents: false,
  },
};

export const logsNoMatchingState: LogsSurfaceState = {
  ...logsSurfaceState,
  expandedContent: {},
  filterLevel: 'error',
  searchTerm: 'database',
};

export const logsContextMenuState: LogsSurfaceState = {
  ...logsSurfaceState,
  contextMenu: {
    source: 'database',
    visible: true,
    x: 910,
    y: 268,
  },
};

export const logsCopiedState: LogsSurfaceState = {
  ...logsSurfaceState,
  copied: true,
};

export const logsCombinedContentState: LogsSurfaceState = {
  ...logsSurfaceState,
  expandedContent: {
    'log-render-error': 'stack',
  },
  logs: logsSurfaceState.logs.map(log => (
    log.id === 'log-render-error'
      ? {
          ...log,
          meta: {
            attempt: 1,
            endpoint: 'assets.supafan.dev',
            retryScheduled: true,
          },
        }
      : log
  )),
};

export const logsHasMoreState: LogsSurfaceState = {
  ...logsSurfaceState,
  expandedContent: {},
  logs: Array.from({length: 126}, (_, index) => {
    const source = index % 5 === 0 ? 'database' : index % 5 === 1 ? 'flows' : index % 5 === 2 ? 'actions' : index % 5 === 3 ? 'video' : 'app-events';
    const level = index % 11 === 0 ? 'error' : index % 7 === 0 ? 'warn' : index % 3 === 0 ? 'debug' : 'info';
    return {
      id: `log-history-${index}`,
      level,
      message: `Historical checkout log event ${String(index + 1).padStart(3, '0')}`,
      source,
      timestamp: now - index * 1000,
    };
  }),
  searchTerm: '',
};

export const logsLaunchReleaseState: LogsSurfaceState = {
  ...logsSurfaceState,
  expandedContent: {
    'log-launch-release': 'meta',
  },
  filterLevel: 'all',
  logs: [
    {
      id: 'log-launch-release',
      level: 'info',
      message: 'deploy-checkout pipeline completed',
      meta: {
        branch: launchFilmStory.branch,
        command: launchFilmStory.command,
        threadId: launchFilmStory.threads.deployChecklist.id,
      },
      source: 'flows',
      timestamp: now,
    },
    {
      id: 'log-publish-pr',
      level: 'debug',
      message: 'Database migrations completed for checkout tables',
      meta: {
        action: launchFilmStory.flow.actionLabels.migrations,
        durationMs: 1284,
      },
      source: 'actions',
      timestamp: now - 5_000,
    },
    {
      id: 'log-command-route',
      level: 'info',
      message: `Matched user.command route: ${launchFilmStory.command}`,
      meta: {
        branch: launchFilmStory.branch,
        flowId: launchFilmStory.flow.id,
      },
      source: 'flows',
      timestamp: now - 11_000,
    },
  ],
  searchTerm: 'deploy checkout',
};

export function logsLaunchReleaseStateForFrame(frame: number): LogsSurfaceState {
  const local = Math.max(0, frame - 72);
  const searchTerm = revealText('deploy-checkout pipeline completed', local, 4);
  return {
    ...logsLaunchReleaseState,
    expandedContent: local > 38 ? logsLaunchReleaseState.expandedContent : {},
    searchTerm,
  };
}

export function logsSurfaceStateForFrame(frame: number): LogsSurfaceState {
  if (frame > 185) return logsContextMenuState;
  if (frame > 150) return logsFilteredState;
  if (frame > 90) return {...logsSurfaceState, copied: true};
  return logsSurfaceState;
}
