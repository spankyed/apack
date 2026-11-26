import { featureSettings } from '#generated/settings.ts';
import { state } from '#generated/state.ts';
import type { ContractAsks, IncomingOnlyEventsOf, NormalizeAsks } from '@apackdev/sdk/events';
import type { HostLifecycleEvents } from '@apackdev/sdk/framework';

import type { Contract } from './contract.ts';
import type { LogEntry } from './types.ts';
import { randomId } from '@apackdev/sdk/utils';
import { onLog, type LogEvent } from '@apackdev/sdk/logger';
import type { LogsSettings } from '#generated/types.ts';
import { isSourceExcluded, filterLogsByExcludedSources } from './utils.ts';

// Resolve the effective exclusion list: when showAppEvents is falsy, treat 'app-events' as excluded.
function effectiveExcludedSources(settings: LogsSettings | undefined): string[] {
  const base = settings?.excludedSources ?? [];
  return settings?.showAppEvents ? base : [...base, 'app-events'];
}

const DEFAULT_SETTINGS: LogsSettings = { maxLogs: 1000, excludedSources: [], showAppEvents: false };

type LogsShape = {
  data: Contract['context'];
  internal: { type: 'ADD_LOG'; log: LogEvent };
};

export const logsSystem = state<
  LogsShape,
  IncomingOnlyEventsOf<Contract> | Extract<HostLifecycleEvents, { type: 'FEATURE_SETTINGS_UPDATED' }>,
  NormalizeAsks<ContractAsks<Contract>>
>()({
  data: { logs: [] },
  listen: ({ send }) => onLog((log) => send({ type: 'ADD_LOG', log })),
  on: {
    CLEAR_LOGS: (_event, { broadcast }) => {
      broadcast('logs', { type: 'LOGS_CLEARED' });
      return { data: { logs: [] } };
    },
    // Each window showing the logs asks for them again, filtered by what the settings now say
    FEATURE_SETTINGS_UPDATED: (_event, { data }) => {
      const settings = featureSettings.forFeature('logs').get();
      const maxLogs = settings?.maxLogs || 1000;
      if (data.logs.length > maxLogs) {
        return { data: { logs: data.logs.slice(data.logs.length - maxLogs) } };
      }
    },
  },
  internal: {
    ADD_LOG: ({ log }, { data, broadcast }) => {
      const newLog: LogEntry = {
        ...log,
        id: randomId(),
        timestamp: Date.now(),
      };

      const settings = featureSettings.forFeature('logs').get();
      const maxLogs = settings?.maxLogs || 1000;
      const combined = [newLog, ...data.logs];
      const updatedLogs = combined.length > maxLogs ? combined.slice(0, maxLogs) : combined;

      const excludedSources = effectiveExcludedSources(settings);
      if (!isSourceExcluded(newLog.source, excludedSources)) {
        broadcast('logs', { type: 'LOG_ADDED', log: newLog });
      }

      return { data: { logs: updatedLogs } };
    },
  },
  answers: {
    /** The buffer as the settings filter it, newest first and no more than they keep */
    GET_LOGS: (_args, { data }) => {
      const settings = featureSettings.forFeature('logs').get() ?? DEFAULT_SETTINGS;
      const kept = data.logs.slice(0, settings.maxLogs || DEFAULT_SETTINGS.maxLogs);
      return { logs: filterLogsByExcludedSources(kept, effectiveExcludedSources(settings)), settings };
    },
  },
});

export default logsSystem;
