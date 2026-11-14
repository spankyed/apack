import type {FlowNodeFormState} from '../../agentbuddy-ui/flows/flowTypes';

export const flowNodeFormDemoStates: FlowNodeFormState[] = [
  {
    canAddNextStep: true,
    nodeKind: 'action',
    nodeLabel: 'start claude code work mode',
    sections: [
      {
        action: {icon: 'code', label: 'Code'},
        fields: [
          {label: 'Mode', type: 'select', value: 'Template'},
          {label: 'Action', type: 'select', value: 'Create branch plan', description: 'Run a saved action template from this blueprint step.'},
        ],
        title: 'Template',
      },
      {
        fields: [
          {label: 'repository', required: true, value: 'AgentBuddy'},
          {label: 'branch', required: true, value: 'as/react-launch-film'},
          {label: 'brief', type: 'textarea', value: 'Align the launch film surfaces with the real app UI and prepare the PR path.'},
        ],
        title: 'Field mappings',
      },
    ],
  },
  {
    canAddNextStep: true,
    nodeKind: 'flow',
    nodeLabel: 'start command listener',
    sections: [
      {
        action: {icon: 'external', label: 'Open Flow'},
        fields: [
          {label: 'Flow', type: 'select', value: 'Release Automation', description: 'Create branch, publish, and prepare a pull request from one blueprint.'},
        ],
        title: 'Flow',
      },
      {
        items: [
          {
            fields: [
              {label: 'Payload', value: '$.event.data.launch', description: 'This value will be passed as the payload to the flow entry event.'},
            ],
            label: 'Entry Parameter',
          },
        ],
        title: 'Entry Parameter',
      },
    ],
  },
  {
    canAddNextStep: true,
    nodeKind: 'switch',
    nodeLabel: 'route release path',
    sections: [
      {
        action: {icon: 'plus', label: 'Add Branch'},
        items: [
          {
            badge: '1',
            fields: [
              {label: 'Label', value: 'ready_to_publish'},
              {label: 'Key', value: 'branch.ready'},
              {label: 'Operator', type: 'select', value: 'equals'},
              {label: 'Value', value: 'true'},
            ],
            label: 'Publish branch',
          },
          {
            badge: 'else',
            description: 'Continue editing the action template until the branch is ready.',
            label: 'Fallback',
            tone: 'warning',
          },
        ],
        title: 'Branches',
      },
      {
        fields: [
          {
            filePath: 'actions/create-branch-plan.ts',
            height: 170,
            label: 'Inline preview',
            type: 'code',
            value: `export async function run(input) {
  const branch = await code.createBranch(input.branch);
  const plan = await agent.writePlan(input.brief);

  return {
    branch,
    plan,
  };
}`,
          },
        ],
        title: 'Code branch',
      },
    ],
  },
  {
    canAddNextStep: true,
    nodeKind: 'listener',
    nodeLabel: 'start command listener',
    sections: [
      {
        fields: [
          {label: 'Scope', type: 'segmented', options: [{label: 'Global', selected: true}, {label: 'Local'}, {label: 'Entry'}]},
          {label: 'Event tag', value: 'release.command'},
          {label: 'Enable Debounce', type: 'checkbox', checked: true, value: 'Enable Debounce'},
          {label: 'Milliseconds', value: '500'},
        ],
        title: 'Listener',
      },
    ],
  },
  {
    canAddNextStep: true,
    nodeKind: 'schedule',
    nodeLabel: 'run release checks',
    sections: [
      {
        fields: [
          {label: 'Frequency', type: 'segmented', options: [{label: 'Seconds'}, {label: 'Minute'}, {label: 'Hourly'}, {label: 'Daily', selected: true}, {label: 'Weekly'}, {label: 'Monthly'}]},
          {label: 'Custom', type: 'checkbox', checked: false, value: 'Custom'},
          {label: 'At minute', type: 'select', value: ':00'},
          {label: 'At hour', type: 'select', value: '09:00'},
          {label: 'On days', type: 'segmented', options: [{label: 'Mo', selected: true}, {label: 'Tu', selected: true}, {label: 'We', selected: true}, {label: 'Th', selected: true}, {label: 'Fr', selected: true}]},
          {label: 'Cron', value: '0 9 * * 1-5'},
        ],
        title: 'Schedule',
      },
    ],
  },
  {
    canAddNextStep: true,
    nodeKind: 'fire',
    nodeLabel: 'notify release flow',
    sections: [
      {
        fields: [
          {label: 'Event type', value: 'release.preview.ready'},
          {label: 'Scope', type: 'segmented', options: [{label: 'Local', selected: true}, {label: 'Global'}]},
        ],
        title: 'Event type',
      },
      {
        items: [
          {
            fields: [
              {label: 'payload', value: '$.lastStep.result', description: 'Map data from blueprint context to event payload.'},
            ],
            label: 'Payload Mapping',
          },
        ],
        title: 'Payload Mapping',
      },
    ],
  },
  {
    canAddNextStep: true,
    nodeKind: 'create',
    nodeLabel: 'create launch thread',
    sections: [
      {
        fields: [
          {label: 'Entity type', type: 'select', value: 'Thread'},
          {label: 'Entity id', value: 'Auto-generated if empty'},
          {label: 'Infer label', type: 'checkbox', checked: true, value: 'INFER LABEL'},
        ],
        title: 'Entity',
      },
    ],
  },
  {
    canAddNextStep: true,
    nodeKind: 'llm',
    nodeLabel: 'draft release summary',
    sections: [
      {
        fields: [
          {label: 'Model', type: 'select', value: 'Claude 3.5 Sonnet', description: '200k context window - $3/1k in, $15/1k out'},
          {label: 'Prompt Template', type: 'select', value: 'Release summary'},
        ],
        title: 'Model',
      },
      {
        items: [
          {
            fields: [
              {label: 'launch_notes', value: '$.event.data.notes', description: 'Source launch notes from the triggering context.'},
              {label: 'pr_plan', value: '$.lastStep.result', description: 'Use the previous step output as PR plan context.'},
            ],
            label: 'Field Mappings',
          },
        ],
        title: 'Field Mappings',
      },
    ],
  },
];

export function flowNodeFormForFrame(frame: number): FlowNodeFormState {
  const index = Math.min(flowNodeFormDemoStates.length - 1, Math.floor(frame / 34));
  return flowNodeFormDemoStates[index];
}
