import type {BrainSurfaceState} from '../../agentbuddy-ui/brain/brainTypes';

const baseTime = Date.UTC(2026, 4, 25, 14, 34, 18);

export const brainSurfaceState: BrainSurfaceState = {
  canGoBack: false,
  events: [
    {eventType: 'launch.context.updated', id: 'event-context', label: 'Launch context updated', scope: 'app', triggerType: 'listener'},
    {cronExpression: '0 9 * * 1', eventType: 'release.workflow.scheduled', id: 'event-release', label: 'Release workflow scheduled', scope: 'app', triggerType: 'schedule'},
    {eventType: 'code.branch.published', id: 'event-code', label: 'Code branch published', scope: 'app', triggerType: 'listener'},
  ],
  flowTNodeId: 'TNode-Root',
  pulsingEventType: 'code.branch.published',
  selectedNodeId: 'draft-report',
  showLeftPanel: true,
  tracks: [
    {
      children: [
        {
          children: [
            {
              id: 'draft-report',
              kind: 'action',
              label: 'Draft launch report',
              nodeAttributes: {
                reportType: 'launch-summary',
                result: {
                  sections: ['context', 'assets', 'release checks'],
                  status: 'ready',
                },
              },
              completedAt: baseTime + 5400,
              startedAt: baseTime + 3000,
              status: 'completed',
              stepNodeType: 'action',
            },
            {
              children: [
                {
                  id: 'notify-team',
                  kind: 'action',
                  label: 'Notify release team',
                  startedAt: baseTime + 7000,
                  status: 'active',
                  stepNodeType: 'action',
                },
              ],
              id: 'run-publish-flow',
              kind: 'flow',
              label: 'Run publish workflow',
              status: 'active',
              stepNodeType: 'flow',
            },
          ],
          exits: ['report', 'publish'],
          id: 'branch-published',
          kind: 'listener',
          label: 'Branch published',
          completedAt: baseTime + 1800,
          eventType: 'code.branch.published',
          startedAt: baseTime,
          status: 'completed',
          subtitle: 'code.branch.published',
        },
      ],
      id: 'release-root',
      kind: 'entry',
      label: 'Release automation',
      status: 'completed',
      subtitle: 'launch.release',
    },
  ],
};

export const brainPausedState: BrainSurfaceState = {
  ...brainSurfaceState,
  brainIsPaused: true,
  selectedNodeId: undefined,
};

export const brainStoppedState: BrainSurfaceState = {
  ...brainSurfaceState,
  brainIsDead: true,
  selectedNodeId: undefined,
};

export const brainEmptyEventsState: BrainSurfaceState = {
  ...brainSurfaceState,
  events: [],
  pulsingEventType: undefined,
  selectedNodeId: undefined,
};

export const brainNestedFlowState: BrainSurfaceState = {
  ...brainSurfaceState,
  canGoBack: true,
  flowTNodeId: 'Run publish workflow',
  selectedNodeId: 'notify-team',
  tracks: [
    {
      children: [
        {
          id: 'notify-team',
          kind: 'action',
          label: 'Notify release team',
          nodeAttributes: {
            channel: '#launch',
            message: 'Release workflow is ready for review.',
          },
          completedAt: baseTime + 7600,
          startedAt: baseTime + 7000,
          status: 'active',
          stepNodeType: 'action',
        },
      ],
      id: 'publish-entry',
      kind: 'entry',
      label: 'Publish workflow',
      status: 'completed',
      subtitle: 'flow.entry',
    },
  ],
};

export const brainLaunchCommandState: BrainSurfaceState = {
  canGoBack: false,
  events: [
    {active: true, eventType: 'user.command', id: 'event-replace-obsolete-apps', label: '/replace-obsolete-apps', scope: 'app', triggerType: 'listener'},
    {eventType: 'logs.info', id: 'event-logs', label: 'all obsolete apps removed', scope: 'app', triggerType: 'listener'},
    {eventType: 'database.message.created', id: 'event-message', label: 'Command message saved', scope: 'app', triggerType: 'listener'},
  ],
  flowTNodeId: 'TNode-Root',
  pulsingEventType: 'user.command',
  selectedNodeId: 'delete-obsolete-apps',
  showLeftPanel: true,
  tracks: [
    {
      children: [
        {
          children: [
            {
              children: [
                {
                  id: 'delete-obsolete-apps',
                  kind: 'action',
                  label: 'Find and delete obsolete apps',
                  nodeAttributes: {
                    removed: ['anti-gravity', 'cursor', 'vscode', 'notion', 'obsidian', 'tick-tick'],
                    result: '6 apps removed',
                  },
                  completedAt: baseTime + 1800,
                  startedAt: baseTime + 900,
                  status: 'completed',
                  stepNodeType: 'action',
                },
                {
                  id: 'log-obsolete-apps',
                  kind: 'action',
                  label: 'Log obsolete apps removed',
                  nodeAttributes: {
                    message: 'all obsolete apps removed',
                    source: 'flows',
                  },
                  completedAt: baseTime + 2400,
                  startedAt: baseTime + 1900,
                  status: 'completed',
                  stepNodeType: 'action',
                },
              ],
              exits: ['/replace-obsolete-apps', 'Else'],
              id: 'route-command',
              kind: 'switch',
              label: 'is /replace-obsolete-apps',
              completedAt: baseTime + 800,
              startedAt: baseTime + 500,
              status: 'completed',
              stepNodeType: 'switch',
            },
          ],
          exits: ['command'],
          id: 'command-listener',
          kind: 'listener',
          label: 'Command listener',
          completedAt: baseTime + 420,
          eventType: 'user.command',
          startedAt: baseTime,
          status: 'completed',
          stepNodeType: 'listener',
          subtitle: 'user.command',
        },
      ],
      id: 'launch-root',
      kind: 'entry',
      label: 'Root Flow',
      status: 'completed',
      subtitle: '/replace-obsolete-apps',
    },
  ],
};

export function brainLaunchCommandStateForFrame(frame: number): BrainSurfaceState {
  const local = Math.max(0, frame - 222);
  const showSwitch = local > 14;
  const showDelete = local > 30;
  const showLog = local > 48;
  const selectedNodeId =
    showLog ? 'log-obsolete-apps'
      : showDelete ? 'delete-obsolete-apps'
        : showSwitch ? 'route-command'
          : 'command-listener';

  return {
    ...brainLaunchCommandState,
    events: brainLaunchCommandState.events.filter((event, index) => (
      index === 0 || (index === 1 && showLog) || (index === 2 && local > 58)
    )),
    pulsingEventType: local < 24 ? 'user.command' : showLog ? 'logs.info' : undefined,
    selectedNodeId,
    tracks: [
      {
        ...brainLaunchCommandState.tracks[0],
        status: showLog ? 'completed' : 'active',
        children: [
          {
            ...brainLaunchCommandState.tracks[0].children![0],
            status: showSwitch ? 'completed' : 'active',
            children: showSwitch ? [
              {
                ...brainLaunchCommandState.tracks[0].children![0].children![0],
                status: showDelete ? 'completed' : 'active',
                children: [
                  ...(showDelete ? [{
                    ...brainLaunchCommandState.tracks[0].children![0].children![0].children![0],
                    status: showLog ? 'completed' as const : 'active' as const,
                  }] : []),
                  ...(showLog ? [{
                    ...brainLaunchCommandState.tracks[0].children![0].children![0].children![1],
                    status: 'completed' as const,
                  }] : []),
                ],
              },
            ] : [],
          },
        ],
      },
    ],
  };
}
