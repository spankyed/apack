import type {LogsSurfaceState} from '../../agentbuddy-ui/logs/logTypes';

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
      message: 'Release workflow started for AgentBuddy launch film',
      meta: {
        flowId: 'release-automation',
        branch: 'as/react-launch-film',
        steps: ['capture context', 'render demos', 'publish assets'],
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
      message: 'Action template "Publish launch report" saved',
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

export function logsSurfaceStateForFrame(frame: number): LogsSurfaceState {
  if (frame > 150) return logsFilteredState;
  if (frame > 90) return {...logsSurfaceState, copied: true};
  return logsSurfaceState;
}
