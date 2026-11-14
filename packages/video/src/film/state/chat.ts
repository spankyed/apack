import type {
  ActionButtonsBlockState,
  ApprovalBlockState,
  ButtonGroupBlockState,
  ChoiceBlockState,
  ContextUsageBlockState,
  FilePickerBlockState,
  LinkBlockState,
  MarkdownBlockState,
  NoteBlockState,
  PlanArtifactState,
  PromptBlockState,
  ProjectSelectBlockState,
  QuestionBlockState,
  SessionListBlockState,
  TextInputBlockState,
  ThinkingBlockState,
  TogglesBlockState,
  ToolActivityBlockState,
  ToolInputBlockState,
} from '../../agentbuddy-ui/threads/threadTypes';
import type {ChatComposerState} from '../../agentbuddy-ui/chat/chatTypes';
import {ease, textReveal} from './timeline';

export type ChatShotView = {
  breadcrumbs: string[];
  composer: ChatComposerState;
  conversation: {
    assistant: {
      artifact: PlanArtifactState;
      markdown: string;
      toolActivity: ReturnType<typeof toolActivityViewForFrame>;
    };
    createdAt: string;
    systemMessage: string;
    userMessage: {
      caretVisible: boolean;
      text: string;
    };
  };
  cursorPath: {
    end: number;
    from: [number, number];
    start: number;
    to: [number, number];
  };
};

export const launchComposerState: ChatComposerState = {
  placeholder: 'Message Agent',
  mode: 'Codex',
  modeOptions: [
    {name: 'Codex', phases: [{name: 'Plan', color: '#2563eb'}, {name: 'Act', color: '#16a34a'}]},
    {name: 'Ask', phases: [{name: 'Read', color: '#525252'}]},
    {name: 'Agent', phases: [{name: 'Plan', color: '#7c3aed'}, {name: 'Run', color: '#ea580c'}]},
    {name: 'Birth', disabled: true},
  ],
  phase: 'Plan',
  bottomTabs: {
    activeLabel: 'AgentBuddy launch film',
    newThreadLabel: 'New thread',
    recentLabel: 'Recent Threads',
  },
};

export const launchComposerWithAttachmentState: ChatComposerState = {
  ...launchComposerState,
  attachments: [{type: 'image', label: 'image 1'}],
};

export const launchComposerModeMenuState: ChatComposerState = {
  ...launchComposerState,
  openSelector: 'mode',
};

export const launchComposerPhaseMenuState: ChatComposerState = {
  ...launchComposerState,
  openSelector: 'phase',
};

export const messageBubbleDemoState = {
  aside: 'Approved launch plan - 4 tickets created',
  createdAt: '9:41 AM',
  longUser: 'Use the attached launch notes and screenshot to turn this into a concise execution path. Keep the release positioning tight, create tickets for the launch film, source-control polish, PR flow, and flow-blueprint review, then produce a single plan that can be shipped from the same work surface.',
  marker: '3 compacted messages',
  references: [
    {
      isImage: true,
      name: 'launch-note.png',
      previewUrl: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20160%20160%22%3E%3Crect%20width%3D%22160%22%20height%3D%22160%22%20fill%3D%22%231b1b1b%22%2F%3E%3Crect%20x%3D%2220%22%20y%3D%2224%22%20width%3D%22120%22%20height%3D%22112%22%20rx%3D%2210%22%20fill%3D%22%23262626%22%20stroke%3D%22%23525252%22%2F%3E%3Cpath%20d%3D%22M38%2054h84M38%2074h70M38%2094h92M38%20114h48%22%20stroke%3D%22%23d4d4d4%22%20stroke-width%3D%226%22%20stroke-linecap%3D%22round%22%2F%3E%3Ccircle%20cx%3D%22118%22%20cy%3D%22118%22%20r%3D%2212%22%20fill%3D%22%233b82f6%22%2F%3E%3C%2Fsvg%3E',
      typeLabel: 'Image',
    },
    {name: 'release-brief.md', typeLabel: 'Markdown'},
  ],
  system: 'Launch AgentBuddy',
  user: 'Turn this launch brief into tickets, notes, and a shippable PR plan.',
  queuedUser: 'Queue the release checklist after this plan is approved.',
  cancelledUser: 'Draft the old tutorial carousel again.',
  assistant: 'I found the launch context and turned it into an execution plan.',
};

export const chatShotState = {
  breadcrumbs: ['Threads', 'Launch Thread'],
  createdAt: '9:41 AM',
  cursorPath: {from: [48, 30] as [number, number], to: [78, 36] as [number, number], start: 80, end: 190},
  systemMessage: 'Launch AgentBuddy',
  prompt: {text: 'Turn this launch brief into tickets, notes, and a shippable PR plan.', from: 24, to: 88, caretUntil: 90},
  response: {text: 'I found the launch context and turned it into an execution plan.', from: 186, to: 248},
};

export const chatToolActivity: ToolActivityBlockState = {
  artifactRef: {
    artifactId: 'launch-operating-plan',
    label: 'Launch Operating Plan',
  },
  defaultOpen: true,
  entries: [
    {id: 'read-launch-notes', tool: 'Read', summary: 'notes/agentbuddy/tasklist/current.md', status: 'ok', durationMs: 312, outputSummary: 'Launch notes loaded'},
    {id: 'create-tickets', tool: 'Task', summary: 'create execution tickets from launch context', status: 'ok', durationMs: 1280, outputSummary: '4 tickets created'},
    {id: 'write-plan', tool: 'Write', summary: 'packages/video/src/film/state/launch-plan.ts', status: 'running'},
    {id: 'compile-flows', tool: 'Bash', summary: 'npm run compile:flows', status: 'running', durationMs: 5200},
  ],
  phase: launchComposerState.phase,
  state: 'streaming',
};

export const launchPlanArtifact: PlanArtifactState = {
  id: 'launch-operating-plan',
  title: 'Launch Operating Plan',
  content: {
    status: 'in-progress',
    notes: '### Launch path\n- [x] Capture **launch context**\n- [x] Create execution tickets\n- [ ] Generate branch and PR plan\n- [ ] Automate `release checks`\n\n| Surface | State |\n| --- | --- |\n| PR flow | ready |\n| Flow blueprint | review |\n\n```sh\nnpm run video:verify\n```\n\n> Same surface, same memory.',
    steps: [
      {id: 'capture-context', title: 'Capture launch context', status: 'done'},
      {id: 'execution-tickets', title: 'Create execution tickets', status: 'done'},
      {id: 'branch-plan', title: 'Generate branch and PR plan', status: 'running'},
      {id: 'release-checks', title: 'Automate release checks', status: 'queued'},
    ],
  },
};

export const thinkingBlockDemoState: ThinkingBlockState = {
  defaultOpen: true,
  label: 'Thinking',
  state: 'done',
  content: 'Need to preserve the launch thread context, create a PR path, and keep the flow blueprint as design-time automation rather than runtime execution.',
};

export const toolInputBlockDemoState: ToolInputBlockState = {
  toolName: 'Edit',
  input: {
    file_path: 'packages/video/src/film/state/chat.ts',
    old_string: 'scene -> one screenshot\nstatic overlay copy\nplaceholder controls',
    new_string: 'moment -> reusable app surface\nauthored Remotion motion\nreal component replicas',
  },
};

export const toolInputWriteDemoState: ToolInputBlockState = {
  toolName: 'Write',
  input: {
    file_path: 'packages/video/src/agentbuddy-ui/threads/ToolInputBlock.tsx',
    content: 'export function ToolInputBlock({state}) {\n  return <ReadonlyEditor state={state} />;\n}\n\nconst mode = \"renderer-preview\";\n',
  },
};

export const toolInputBashDemoState: ToolInputBlockState = {
  toolName: 'Bash',
  input: {
    command: 'npm run video:verify',
  },
};

export const toolInputJsonDemoState: ToolInputBlockState = {
  toolName: 'Read',
  input: {
    path: 'packages/video/src/agentbuddy-ui/FIDELITY.md',
    offset: 1,
    limit: 20,
  },
};

export const approvalBlockDemoState: ApprovalBlockState = {
  allowReason: true,
  approveLabel: 'Approve',
  autoAcceptOption: true,
  denyLabel: 'Deny',
  reason: 'This matches the launch-film direction.',
  reasonPlaceholder: 'Enter your reason...',
};

export const approvalBlockRespondedState: ApprovalBlockState = {
  disabled: true,
  response: {
    approved: true,
    reason: 'Use the real UI replica path and continue.',
  },
};

export const actionButtonsBlockDemoState: ActionButtonsBlockState = {
  buttons: ['submit', 'cancel'],
  submitLabel: 'Run action',
  submitVariant: 'success',
};

export const actionButtonsDisabledDemoState: ActionButtonsBlockState = {
  buttons: ['submit', 'cancel'],
  cancelLabel: 'Cancel',
  submitDisabled: true,
  submitLabel: 'Waiting',
};

export const choiceBlockDemoState: ChoiceBlockState = {
  allowCustom: true,
  choices: [
    {id: 'ship-pr', label: 'Ship PR flow', description: 'Feature the publish, create PR, and details views.'},
    {id: 'flow-blueprints', label: 'Show flow blueprints', description: 'Keep automation design-time and status-free.'},
    {id: 'notes-memory', label: 'Connect notes memory', description: 'Tie notes, tasks, and thread context together.'},
  ],
  customPlaceholder: 'Describe another launch surface...',
  selectedIds: ['ship-pr'],
  skipOption: {id: 'skip', label: 'Skip for now'},
};

export const choiceBlockRespondedState: ChoiceBlockState = {
  choices: [],
  disabled: true,
  displayText: 'Selected:',
  response: 'Ship PR flow',
};

export const questionBlockDemoState: QuestionBlockState = {
  customPlaceholder: 'Name a different surface...',
  currentStep: 0,
  questions: [
    {
      allowCustom: true,
      options: [
        {id: 'pr-flow', label: 'PR flow', description: 'Publish branch, create PR, then show details.'},
        {id: 'tasklist', label: 'Tasklist', description: 'Edit notes, tasks, and launch context.'},
        {id: 'flows', label: 'Flow blueprints', description: 'Show automation as design-time blueprints.'},
      ],
      question: 'Which launch surface should lead the next cut?',
    },
  ],
  selectedIds: ['pr-flow'],
};

export const questionBlockRespondedState: QuestionBlockState = {
  disabled: true,
  questions: [
    {
      options: [{id: 'pr-flow', label: 'PR flow'}],
      question: 'Which launch surface should lead the next cut?',
    },
  ],
  response: 'PR flow',
};

export const buttonGroupBlockDemoState: ButtonGroupBlockState = {
  buttons: [
    {id: 'publish', label: 'Publish branch', variant: 'primary'},
    {id: 'draft', label: 'Create draft', variant: 'secondary'},
    {id: 'close', label: 'Close', variant: 'danger'},
  ],
};

export const buttonGroupRespondedState: ButtonGroupBlockState = {
  buttons: [{id: 'publish', label: 'Publish branch', variant: 'primary'}],
  disabled: true,
  displayText: 'Button pressed',
  response: {buttonId: 'publish'},
};

export const promptBlockDemoState: PromptBlockState = {
  content: 'Confirm the launch cut should emphasize real product surfaces over tutorial walkthroughs.',
};

export const noteBlockDemoState: NoteBlockState = {
  content: 'Flow blueprints stay design-time only. No runtime status indicators in the flow plugin shot.',
  label: 'Launch note',
  variant: 'warning',
};

export const markdownBlockDemoState: MarkdownBlockState = {
  content: '### Launch checklist\n- [x] Real UI surfaces\n- [x] PR flow complete\n- [ ] Blueprint fidelity reviewed\n\n| Review | Owner |\n| --- | --- |\n| code/pr | ready |\n| flows | needs pass |\n\n```ts\nconst surface = \"renderer-faithful\";\n```\n\nRead the [release note](agentbuddy://notes/current).',
  label: 'Generated summary',
};

export const togglesBlockDemoState: TogglesBlockState = {
  toggles: [
    {id: 'ship-pr', label: 'Create PR after publish', default: true},
    {id: 'notify-launch', label: 'Notify launch thread', description: 'Post the final checklist', default: false},
  ],
};

export const sessionListBlockDemoState: SessionListBlockState = {
  sessions: [
    {id: '9f42c8a710ef', title: 'React launch film', modifiedAt: '2m ago', size: 428_000},
    {id: '77bb1a4d52a0', title: 'Flow blueprint review', modifiedAt: '18m ago', size: 214_000},
    {id: '43d0ac921eb4', title: '(untitled)', modifiedAt: '1h ago', size: 92_000},
  ],
};

export const linkBlockDemoState: LinkBlockState = {
  links: [
    {icon: 'file-text', label: 'Open launch note'},
    {icon: 'message-square', label: 'View source thread'},
    {icon: 'external-link', label: 'Open PR'},
  ],
};

export const contextUsageBlockDemoState: ContextUsageBlockState = {
  model: 'claude-sonnet-4.5',
  totalTokens: 128_400,
  maxTokens: 200_000,
  percentage: 64,
  categories: [
    {name: 'System prompt', tokens: 12_800, percentage: 6.4},
    {name: 'System tools', tokens: 18_400, percentage: 9.2},
    {name: 'Memory files', tokens: 24_600, percentage: 12.3},
    {name: 'Skills', tokens: 8_200, percentage: 4.1},
    {name: 'Messages', tokens: 64_400, percentage: 32.2},
  ],
  memoryFiles: [
    {type: 'note', path: '/AgentBuddy/Tasklist/current.md', tokens: 7400},
    {type: 'brief', path: '/AgentBuddy/Videos/launch-film.md', tokens: 5200},
  ],
};

export const textInputBlockDemoState: TextInputBlockState = {
  multiline: true,
  placeholder: 'Enter launch note...',
  rows: 2,
  suggestions: ['Tighten the launch cut', 'Show the PR flow'],
  value: 'Focus on the real app surfaces.',
};

export const filePickerBlockDemoState: FilePickerBlockState = {
  allowMultiple: true,
  fileType: 'file',
  selectedPaths: ['packages/video/src/film/state/chat.ts', 'packages/video/src/agentbuddy-ui/threads/MessageBubble.tsx'],
};

export const projectSelectBlockDemoState: ProjectSelectBlockState = {
  projects: [
    {name: 'AgentBuddy', color: '#3b82f6', directories: ['/Users/spankyed/Develop/Projects/AgentBuddy']},
    {name: 'Clientlabs', color: '#10b981', directories: ['/Users/spankyed/Develop/Projects/Clientlabs']},
  ],
};

export const projectSelectRespondedState: ProjectSelectBlockState = {
  disabled: true,
  displayText: 'Selected project:',
  response: '/Users/spankyed/Develop/Projects/AgentBuddy',
  projects: [
    {name: 'AgentBuddy', color: '#3b82f6', directories: ['/Users/spankyed/Develop/Projects/AgentBuddy']},
  ],
};

export function toolActivityViewForFrame(frame: number) {
  return {
    rowOpacities: chatToolActivity.entries.map((_, index) => ease(frame, 78 + index * 18, 96 + index * 18)),
    state: frame > 230 ? {...chatToolActivity, state: 'done' as const} : chatToolActivity,
  };
}

export function chatViewForFrame(frame: number) {
  return {
    prompt: textReveal(chatShotState.prompt.text, frame, chatShotState.prompt.from, chatShotState.prompt.to),
    promptCaretVisible: frame < chatShotState.prompt.caretUntil,
    response: textReveal(chatShotState.response.text, frame, chatShotState.response.from, chatShotState.response.to),
    toolActivity: toolActivityViewForFrame(frame),
  };
}

export function chatShotViewForFrame(frame: number): ChatShotView {
  const view = chatViewForFrame(frame);
  return {
    breadcrumbs: chatShotState.breadcrumbs,
    composer: launchComposerState,
    conversation: {
      assistant: {
        artifact: launchPlanArtifact,
        markdown: view.response,
        toolActivity: view.toolActivity,
      },
      createdAt: chatShotState.createdAt,
      systemMessage: chatShotState.systemMessage,
      userMessage: {
        caretVisible: view.promptCaretVisible,
        text: view.prompt,
      },
    },
    cursorPath: chatShotState.cursorPath,
  };
}
