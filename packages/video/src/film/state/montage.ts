import type {PluginId} from '../../agentbuddy-ui/chrome/Toolbar';
import type {ChatComposerState} from '../../agentbuddy-ui/chat/chatTypes';
import type {BrowserSurfaceState} from '../../agentbuddy-ui/browser';
import type {DatabaseSurfaceState} from '../../agentbuddy-ui/database/databaseTypes';
import type {LogsSurfaceState} from '../../agentbuddy-ui/logs/logTypes';
import {browserSurfaceStateForFrame} from './browser';
import {launchComposerState} from './chat';
import {databaseMessagesBeforeDateState, databaseMessageLookupState} from './database';
import {logsLaunchReleaseStateForFrame} from './logs';
import {launchFilmStory} from './launchStory';
import {ease, mix} from './timeline';
import {revealText} from './typing';

export type MontageShotView =
  | {
      activePlugin: PluginId;
      breadcrumbs: string[];
      composer: ChatComposerState;
      conversation: {
        assistantMarkdown: string;
        createdAt: string;
        messageStyles: {
          assistant: {
            opacity: number;
            transform: string;
          };
          user: {
            opacity: number;
            transform: string;
          };
        };
        topInset: number;
        userMessage: string;
      };
      surface: 'conversation';
    }
  | {
      activePlugin: PluginId;
      breadcrumbs: string[];
      composer: false;
      logs: LogsSurfaceState;
      surface: 'logs';
    }
  | {
      activePlugin: PluginId;
      breadcrumbs: string[];
      browser: BrowserSurfaceState;
      composer: false;
      surface: 'browser';
    }
  | {
      activePlugin: PluginId;
      breadcrumbs: string[];
      composer: false;
      database: DatabaseSurfaceState;
      surface: 'database';
    };

// Surface switches (and the second database query) land on these source
// frames; MontageShot dissolves across each boundary instead of hard-cutting.
export const montageSegmentBoundaries = [72, 142, 196, 252];
export const montageDissolveFrames = 8;

export function montageShotViewForFrame(frame: number): MontageShotView {
  if (frame < 72) {
    const command = launchFilmStory.command;
    const composerState = {
      ...launchComposerState,
      bottomTabs: {
        ...launchComposerState.bottomTabs!,
        active: 'active' as const,
        activeLabel: launchFilmStory.threads.deployChecklist.title,
      },
      sendPressed: frame > 26 && frame < 34,
      // Command types at the shared cadence (ends ~28), then clears on send.
      text: frame < 32 ? revealText(command, frame, 4) : '',
    };
    return {
      activePlugin: 'threads',
      breadcrumbs: ['Threads', launchFilmStory.threads.deployChecklist.title],
      composer: composerState,
      conversation: {
        assistantMarkdown: frame > 30
          ? revealText('Matched the deploy-checkout command, ran migrations, and notified the #releases channel.', frame, 30, 'stream')
          : '',
        createdAt: 'just now',
        messageStyles: {
          assistant: {opacity: ease(frame, 32, 46), transform: `translateY(${mix(18, 0, ease(frame, 32, 46))}px)`},
          user: {opacity: ease(frame, 26, 36), transform: `translateY(${mix(14, 0, ease(frame, 26, 36))}px)`},
        },
        topInset: 96,
        userMessage: command,
      },
      surface: 'conversation',
    };
  }

  if (frame < 142) {
    return {
      activePlugin: 'logs',
      breadcrumbs: ['Logs'],
      composer: false,
      logs: logsLaunchReleaseStateForFrame(frame),
      surface: 'logs',
    };
  }

  if (frame < 252) {
    return {
      activePlugin: 'database',
      breadcrumbs: ['Database'],
      composer: false,
      database: databaseStateForMontageFrame(frame),
      surface: 'database',
    };
  }

  return {
    activePlugin: 'browser',
    breadcrumbs: ['Browser'],
    browser: browserSurfaceStateForFrame(frame),
    composer: false,
    surface: 'browser',
  };
}

function databaseStateForMontageFrame(frame: number): DatabaseSurfaceState {
  const state = frame < 196 ? databaseMessageLookupState : databaseMessagesBeforeDateState;
  const segmentStart = frame < 196 ? 142 : 196;
  const local = frame - segmentStart;
  const query = revealText(state.currentQuery, local, 0, 'paste');

  if (local < 4) {
    return {
      ...state,
      currentQuery: query,
      executePressed: false,
      executionTime: null,
      isLoading: false,
      queryResult: null,
      successMessage: '',
    };
  }

  if (local < 8) {
    return {
      ...state,
      currentQuery: state.currentQuery,
      executePressed: local < 6,
      executionTime: null,
      isLoading: true,
      queryResult: null,
      successMessage: '',
    };
  }

  return {
    ...state,
    copiedResultRowIndex: local > 24 ? 0 : state.copiedResultRowIndex,
    executePressed: false,
  };
}
