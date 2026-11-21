import type {FlowNodeFormState} from '../../agentbuddy-ui/flows/flowTypes';
import {launchFilmStory} from './launchStory';
import {revealText} from './typing';

const deployCheckoutDescription = 'Run the checkout deploy path: apply database migrations, verify the checkout branch, and notify the releases channel.';

const deployCheckoutCode = `export async function run({ flows, code, logs }) {
  await code.ensureBranch("${launchFilmStory.branch}");
  await flows.run("database.migrate", {
    scope: "checkout",
  });
  await logs.info("checkout deploy complete", {
    command: "${launchFilmStory.command}",
    threadId: "${launchFilmStory.threads.deployChecklist.id}",
  });
}`;

export const deployCheckoutFormState: FlowNodeFormState = {
  canAddNextStep: true,
  nodeKind: 'action',
  nodeLabel: launchFilmStory.flow.actionLabels.migrations,
  sections: [
    {
      fields: [
        {label: 'Mode', type: 'select', value: 'Code'},
        {label: 'Description', type: 'textarea', value: deployCheckoutDescription},
      ],
      title: 'Action',
    },
    {
      fields: [
        {
          filePath: 'actions/deploy-checkout.ts',
          height: 220,
          label: 'Code',
          language: 'typescript',
          type: 'code',
          value: deployCheckoutCode,
        },
      ],
      title: 'Code',
    },
  ],
};

export function deployCheckoutFormStateForFrame(frame: number): FlowNodeFormState {
  const local = Math.max(0, frame - 252);
  const description = revealText(deployCheckoutDescription, local, 4);
  const code = revealText(deployCheckoutCode, local, 8, 'stream');

  return {
    ...deployCheckoutFormState,
    canAddNextStep: local > 104,
    sections: deployCheckoutFormState.sections.map(section => ({
      ...section,
      fields: section.fields?.map(field => {
        if (field.label === 'Description') return {...field, value: description};
        if (field.label === 'Code') return {...field, value: code};
        return field;
      }),
    })),
  };
}

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
          {label: 'repository', required: true, value: launchFilmStory.repo},
          {label: 'branch', required: true, value: launchFilmStory.branch},
          {label: 'brief', type: 'textarea', value: 'Wire checkout deployment around Stripe, receipts, discount codes, and the PR path.'},
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
          {label: 'Flow', type: 'select', value: launchFilmStory.flow.title, description: 'Run migrations and notify the release channel from one blueprint.'},
        ],
        title: 'Flow',
      },
      {
        items: [
          {
            fields: [
              {label: 'Payload', value: '$.event.data.checkout', description: 'This value will be passed as the payload to the flow entry event.'},
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
    nodeLabel: 'route checkout command',
    sections: [
      {
        action: {icon: 'plus', label: 'Add Branch'},
        items: [
          {
            badge: '1',
            fields: [
              {label: 'Label', value: launchFilmStory.command},
              {label: 'Key', value: 'command.text'},
              {label: 'Operator', type: 'select', value: 'equals'},
              {label: 'Value', value: launchFilmStory.command},
            ],
            label: 'Deploy checkout',
          },
          {
            badge: 'else',
            description: 'Ignore commands that do not match the checkout deploy route.',
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
          {label: 'Event tag', value: 'user.command'},
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
    nodeLabel: 'run checkout checks',
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
    nodeLabel: launchFilmStory.flow.actionLabels.notify,
    sections: [
      {
        fields: [
          {label: 'Event type', value: 'checkout.deploy.ready'},
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
    nodeLabel: `create ${launchFilmStory.threads.addDiscountCodeSupport.title}`,
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
    nodeLabel: 'draft checkout summary',
    sections: [
      {
        fields: [
          {label: 'Model', type: 'select', value: 'Claude 3.5 Sonnet', description: '200k context window - $3/1k in, $15/1k out'},
          {label: 'Prompt Template', type: 'select', value: 'Checkout deploy summary'},
        ],
        title: 'Model',
      },
      {
        items: [
          {
            fields: [
              {label: 'checkout_notes', value: '$.event.data.notes', description: 'Source checkout notes from the triggering context.'},
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
