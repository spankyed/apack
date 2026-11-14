import type {ActionCategory, ActionEntity, ActionsSurfaceState} from '../../agentbuddy-ui/actions/actionTypes';

export const actionCategories: ActionCategory[] = [
  {name: 'database', color: '#60a5fa'},
  {name: 'communication', color: '#4ade80'},
  {name: 'integration', color: '#facc15'},
  {name: 'utility', color: '#c084fc'},
  {name: 'storage', color: '#818cf8'},
];

const runLaunchQuery = `const { launchId, channel } = params;

await services.logger.info('Preparing launch report', { launchId });

const rows = await services.database.query(
  'SELECT * FROM launch_events WHERE launch_id = ? ORDER BY created_at DESC',
  [launchId]
);

await services.http.post(channel, {
  text: \`Launch report ready for \${launchId}\`,
  count: rows.length,
});

return {
  ok: true,
  events: rows,
};`;

export const actionsListState: ActionsSurfaceState = {
  actions: [
    {
      actionFn: runLaunchQuery,
      category: 'database',
      createdAt: 1769447240000,
      description: 'Collects launch telemetry and posts the summary to the release room.',
      id: 'action_launch_report',
      input: {
        launchId: {description: 'Launch identifier to summarize', required: true, type: 'string'},
        channel: {description: 'Destination webhook or room', required: true, type: 'string'},
        includeErrors: {description: 'Include failed event rows', required: false, type: 'boolean'},
      },
      label: 'Publish launch report',
      output: '{\n  "type": "object",\n  "properties": {\n    "ok": {"type": "boolean"},\n    "events": {"type": "array"}\n  }\n}',
      updatedAt: 1769449880000,
    },
    {
      actionFn: 'return await services.http.post(params.url, params.payload);',
      category: 'integration',
      createdAt: 1769360840000,
      description: 'Sends a signed payload to an external webhook.',
      id: 'action_webhook',
      input: {
        payload: {description: 'JSON payload', required: true, type: 'object'},
        url: {description: 'Webhook URL', required: true, type: 'string'},
      },
      label: 'Post webhook payload',
      updatedAt: 1769442640000,
    },
    {
      actionFn: 'await services.logger.info(params.message); return { sent: true };',
      category: 'utility',
      createdAt: 1769274440000,
      description: 'Writes an event to the workspace activity stream.',
      id: 'action_log_event',
      input: {
        message: {description: 'Message to log', required: true, type: 'string'},
      },
      label: 'Record workspace event',
      updatedAt: 1769353640000,
    },
  ],
  categories: actionCategories,
  hasActions: true,
  hasMore: false,
  loadingMore: false,
  selectedCategories: [],
  view: 'list',
};

export const actionsEmptyState: ActionsSurfaceState = {
  actions: [],
  categories: actionCategories,
  hasActions: false,
  hasMore: false,
  loadingMore: false,
  selectedCategories: [],
  view: 'list',
};

export const actionsLoadingMoreState: ActionsSurfaceState = {
  ...actionsListState,
  hasMore: true,
  loadingMore: true,
};

export const actionsFilteredState: ActionsSurfaceState = {
  ...actionsListState,
  actions: actionsListState.actions.filter(action => action.category === 'integration'),
  categoryFilterOpen: true,
  selectedCategories: ['integration'],
};

export const actionCreateState: ActionsSurfaceState = {
  categories: actionCategories,
  formData: {
    actionFn: '',
    category: '',
    description: '',
    input: {},
    label: '',
    output: '',
  },
  metadataExpanded: true,
  outputExpanded: false,
  parametersExpanded: true,
  view: 'create',
};

const selectedAction = actionsListState.actions[0];

export const actionDetailState: ActionsSurfaceState = {
  action: selectedAction,
  categories: actionCategories,
  formData: {
    actionFn: selectedAction.actionFn,
    category: selectedAction.category,
    description: selectedAction.description,
    input: selectedAction.input,
    label: selectedAction.label,
    output: selectedAction.output,
  },
  expandedParameterKeys: ['launchId'],
  metadataExpanded: true,
  outputExpanded: true,
  parametersExpanded: true,
  view: 'detail',
};

export const actionCollapsedSectionsState: ActionsSurfaceState = {
  ...actionDetailState,
  expandedParameterKeys: [],
  metadataExpanded: false,
  outputExpanded: false,
  parametersExpanded: false,
};

export function actionsSurfaceStateForFrame(frame: number): ActionsSurfaceState {
  return frame < 90 ? actionsListState : actionDetailState;
}
