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
import type {ChatComposerInlineNode, ChatComposerState} from '../../agentbuddy-ui/chat/chatTypes';
import {REFERENCE_CATEGORIES} from '../../agentbuddy-ui/chat/referenceConfig';
import {launchFilmStory} from './launchStory';
import {filmProjectDirectories, filmProjects} from './paths';
import {ease, mix} from './timeline';
import {revealText} from './typing';
import {createInteractionModel, type InteractionStep} from '../interaction/interactionTimeline';

const checkoutMockupSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
  <rect width="160" height="160" rx="18" fill="#0f172a"/>
  <rect x="14" y="16" width="132" height="128" rx="12" fill="#f8fafc"/>
  <rect x="26" y="30" width="66" height="9" rx="4.5" fill="#0f172a"/>
  <text x="26" y="53" fill="#64748b" font-family="Inter, Arial, sans-serif" font-size="8">Supafan Checkout</text>
  <rect x="26" y="62" width="50" height="48" rx="8" fill="#dbeafe"/>
  <path d="M35 96h32M38 84h24" stroke="#2563eb" stroke-width="5" stroke-linecap="round"/>
  <rect x="88" y="62" width="46" height="9" rx="4.5" fill="#e2e8f0"/>
  <rect x="88" y="79" width="46" height="9" rx="4.5" fill="#e2e8f0"/>
  <rect x="88" y="96" width="30" height="9" rx="4.5" fill="#e2e8f0"/>
  <rect x="26" y="121" width="108" height="14" rx="7" fill="#635bff"/>
  <text x="54" y="131" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="8" font-weight="700">Pay with Stripe</text>
</svg>`;

export const launchCheckoutMockupPreviewUrl = `data:image/svg+xml,${encodeURIComponent(checkoutMockupSvg)}`;
const recentThreadTimestamps = {
  now: new Date('2026-05-27T19:52:00').getTime(),
  twoMinutesAgo: new Date('2026-05-27T19:50:00').getTime(),
  eightMinutesAgo: new Date('2026-05-27T19:44:00').getTime(),
};

const referenceCategorySuggestions = (query = '') => {
  const normalizedQuery = query.toLowerCase();
  return REFERENCE_CATEGORIES
    .filter(category => category.label.toLowerCase().includes(normalizedQuery))
    .map(category => category.id);
};

export const chatDemoRecentThreadTimestamps = recentThreadTimestamps;

export type ChatShotView = {
  breadcrumbs: string[];
  composer: ChatComposerState;
  conversation: {
    additionalAssistantMessages?: Array<{
      approval?: ApprovalBlockState;
      autoHide?: boolean;
      markdown: string;
      markdownBlock?: MarkdownBlockState;
      promptBlock?: PromptBlockState;
      style?: {
        opacity: number;
        transform: string;
      };
      thinking?: ThinkingBlockState;
      toolActivity?: ReturnType<typeof toolActivityViewForFrame>;
    }>;
    assistant: {
      approval?: ApprovalBlockState;
      markdown: string;
      markdownBlock?: MarkdownBlockState;
      markdownStyle?: {opacity: number};
      promptBlock?: PromptBlockState;
      thinking?: ThinkingBlockState;
      thinkingStyle?: {
        opacity: number;
        transform: string;
      };
      toolActivity?: ReturnType<typeof toolActivityViewForFrame>;
    };
    createdAt: string;
    queuedMessage?: {text: string};
    systemMessage?: string;
    userMessage: {
      caretVisible: boolean;
      content?: ChatComposerInlineNode[];
      text: string;
    };
  };
  conversationStyle: {
    opacity: number;
    transform: string;
  };
  messageStyles: {
    assistant: {
      opacity: number;
      transform: string;
    };
    system: {
      opacity: number;
      transform: string;
    };
    user: {
      opacity: number;
      transform: string;
    };
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
  quickPrompts: [
    {id: 'qp-review', text: 'Conduct a thorough review of these changes for bugs and completeness, then report back with findings'},
    {id: 'qp-create-ticket', text: 'create the next thread from this plan'},
    {id: 'qp-link-parent', text: 'link this to the parent ticket'},
  ],
  bottomTabs: {
    activeLabel: launchFilmStory.threads.checkoutImplementation.title,
  },
};

export const launchComposerWithAttachmentState: ChatComposerState = {
  ...launchComposerState,
  attachments: [{type: 'image', label: 'checkout mockup', previewUrl: launchCheckoutMockupPreviewUrl}],
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
  aside: 'Approved checkout plan - 3 tickets created',
  createdAt: '9:41 AM',
  longUser: 'Use the attached checkout notes and screenshot to turn this into a concise execution path. Cover Stripe payments, receipts, discount codes, and creator payouts.',
  marker: '3 compacted messages',
  references: {
    files: [{name: 'release-brief.md', typeLabel: 'Markdown'}],
    images: [{name: 'checkout-mockup.svg', url: launchCheckoutMockupPreviewUrl}],
  },
  system: 'Checkout flow implementation',
  user: 'Turn this checkout brief into tickets, notes, and a shippable PR plan.',
  commandUser: '/checkout create tickets from the current tasklist',
  queuedUser: 'Queue the deploy checklist after this plan is approved.',
  cancelledUser: 'Draft the old tutorial carousel again.',
  assistant: 'I found the checkout context and turned it into an execution plan.',
};

export const chatShotState = {
  breadcrumbs: ['Threads', launchFilmStory.threads.checkoutImplementation.title],
  createdAt: '9:41 AM',
  systemMessage: undefined,
  prompt: {text: 'Use #notes:tasklist and this screenshot to scope the checkout flow — Stripe payments, receipts, and discount codes.', from: 24, to: 214, caretUntil: 268},
  response: {text: 'I’ll scope the checkout feature from the tasklist: create the Stripe integration, wire receipt emails, add the discount engine, and prepare the creator payout stub.', from: 306, to: 346},
};

const reviewQuickPromptText = 'Conduct a thorough review of these changes for bugs and completeness, then report back with findings';

const completedDevThreadResponse = 'The checkout flow is wired. Stripe webhook handles payment_intent.succeeded, receipt emails send via Resend, and discount validation works. All three paths pass integration tests.';

const launchPlanMarkdown = `## Supafan Checkout -> Implementation Pass

### Context

The checkout thread has the current tasklist, payment requirements, and a product screenshot in one place. The next step is to turn that context into implementation work without leaving the thread.

Goal: create the implementation tickets, wire the Stripe integration, and prepare the deploy path for a shippable PR.

### Key Discovery

The existing tasklist identifies three pillars: Stripe checkout sessions (webhook-driven), receipt emails (Resend transport), and discount codes (validation middleware). A shared PaymentProvider interface keeps all three behind one dispatch surface.

### Implementation Plan

- Create implementation tickets for each checkout component.
- Design the PaymentProvider interface and session flow.
- Wire Stripe checkout.session.completed webhook handler.
- Configure Resend receipt emails with order summary template.
- Stub discount code validation endpoint.
- Run integration tests across all payment paths.

### Files

\`packages/api/src/services/checkout-service.ts\` - session creation and payment confirmation.

\`packages/api/src/webhooks/stripe-webhook.ts\` - Stripe event handling.

\`packages/api/src/services/receipt-service.ts\` - Resend email transport.`;

const completedDevThreadActivity: ToolActivityBlockState = {
  defaultOpen: false,
  entries: [
    {id: 'inspect-services', tool: 'Read', summary: 'packages/api/src/services', status: 'ok', durationMs: 420, outputSummary: 'Service directory reviewed'},
    {id: 'patch-payment', tool: 'Edit', summary: 'checkout service, Stripe webhooks, receipt emails', status: 'ok', durationMs: 1300, outputSummary: 'Payment flow wired'},
    {id: 'patch-discounts', tool: 'Edit', summary: 'discount engine and validation middleware', status: 'ok', durationMs: 1900, outputSummary: 'Discount codes ready'},
    {id: 'test-checkout', tool: 'Bash', summary: 'npm test -- --filter checkout', status: 'ok', durationMs: 8600, outputSummary: 'Integration tests passed'},
  ],
  phase: launchComposerState.phase,
  state: 'done',
};

export const chatToolActivity: ToolActivityBlockState = {
  defaultOpen: false,
  entries: [
    {id: 'read-checkout-notes', tool: 'Read', summary: 'notes/supafan/tasklist/current.md', status: 'ok', durationMs: 312, outputSummary: 'Checkout tasklist loaded'},
    {id: 'create-tickets', tool: 'Task', summary: 'create implementation tickets from checkout scope', status: 'ok', durationMs: 1280, outputSummary: '3 tickets created'},
    {id: 'write-checkout-service', tool: 'Write', summary: 'packages/api/src/services/checkout-service.ts', status: 'running'},
    {id: 'typecheck', tool: 'Bash', summary: 'npm run typecheck', status: 'running', durationMs: 5200},
  ],
  phase: launchComposerState.phase,
  state: 'streaming',
};

export const launchPlanArtifact: PlanArtifactState = {
  id: 'checkout-implementation-plan',
  title: 'Checkout Implementation Plan',
  content: {
    status: 'in-progress',
    nextStep: 'Review deploy checklist',
    notes: '### Checkout path\n- [x] Design **payment flow**\n- [x] Create tickets\n- [x] Wire Stripe integration\n- [ ] Review deploy checklist\n\n| Surface | State |\n| --- | --- |\n| Stripe | wired |\n| Receipts | wired |\n| Discounts | stubbed |\n\n> Every creator gets paid. Every buyer gets a receipt.',
    steps: [
      {id: 'design-payment-flow', title: 'Design payment flow', status: 'done'},
      {id: 'create-tickets', title: 'Create tickets', status: 'done'},
      {id: 'wire-stripe', title: 'Wire Stripe integration', status: 'done'},
      {id: 'deploy-checklist', title: 'Review deploy checklist', status: 'running'},
    ],
  },
};

export const thinkingBlockDemoState: ThinkingBlockState = {
  defaultOpen: true,
  label: 'Thinking',
  state: 'done',
  content: 'Need to preserve the checkout thread context, create a PR path, and keep the deploy blueprint as design-time automation before runtime execution.',
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
  reason: 'This matches the checkout implementation direction.',
  reasonPlaceholder: 'Enter your reason...',
};

export const launchPlanApprovalState: ApprovalBlockState = {
  options: [
    {label: 'Yes, clear context and auto-accept edits', variant: 'primary'},
    {label: 'Yes, auto-accept edits', variant: 'secondary'},
    {label: 'Deny', variant: 'neutral'},
  ],
};

export const launchPlanThinkingState: ThinkingBlockState = {
  defaultOpen: true,
  label: 'Thinking',
  state: 'streaming',
  content: 'Preparing the implementation pass from the approved checkout plan. Loading the completed Stripe thread and preserving the payment context.',
};

export const approvalBlockRespondedState: ApprovalBlockState = {
  disabled: true,
  response: {
    approved: true,
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
        {id: 'tasklist', label: 'Tasklist', description: 'Edit notes, tasks, and checkout context.'},
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
  content: 'Confirm the checkout pass should keep Stripe, receipts, and discounts in one implementation thread.',
};

export const noteBlockDemoState: NoteBlockState = {
  content: 'The deploy checkout blueprint stays design-time only. Runtime work appears in logs after the command runs.',
  label: 'Checkout note',
  variant: 'warning',
};

export const markdownBlockDemoState: MarkdownBlockState = {
  content: '### Checkout checklist\n- [x] Stripe sessions\n- [x] Receipt emails\n- [ ] Review [deploy note](note://current)\n\n| Surface | Owner |\n| --- | --- |\n| code/pr | sam |\n| deploy flow | ready |\n\n```ts\nconst branch = \"sam/checkout-flow\";\n```',
  label: 'Generated summary',
};

export const togglesBlockDemoState: TogglesBlockState = {
  toggles: [
    {id: 'ship-pr', label: 'Create PR after publish', default: true},
    {id: 'notify-checkout', label: 'Notify deploy thread', description: 'Post the final checkout checklist', default: false},
  ],
};

export const sessionListBlockDemoState: SessionListBlockState = {
  sessions: [
    {id: '9f42c8a710ef', title: launchFilmStory.threads.checkoutImplementation.title, modifiedAt: '2m ago', size: 428_000},
    {id: '77bb1a4d52a0', title: launchFilmStory.threads.stripePaymentIntegration.title, modifiedAt: '18m ago', size: 214_000},
    {id: '43d0ac921eb4', title: '(untitled)', modifiedAt: '1h ago', size: 92_000},
  ],
};

export const linkBlockDemoState: LinkBlockState = {
  links: [
    {icon: 'file-text', label: 'Open checkout note'},
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
    {type: 'note', path: '/Supafan/Tasklist/current.md', tokens: 7400},
    {type: 'brief', path: '/Supafan/Payments/checkout-flow.md', tokens: 5200},
  ],
  skills: [
    {name: 'checkout-flow-fidelity', source: 'workspace', tokens: 8200},
  ],
};

export const textInputBlockDemoState: TextInputBlockState = {
  multiline: true,
  placeholder: 'Enter checkout note...',
  rows: 2,
  suggestions: ['Review checkout coverage', 'Show the PR flow'],
  value: 'Focus on the checkout work surfaces.',
};

export const filePickerBlockDemoState: FilePickerBlockState = {
  allowMultiple: true,
  fileType: 'file',
  selectedPaths: ['packages/video/src/film/state/chat.ts', 'packages/video/src/agentbuddy-ui/threads/MessageBubble.tsx'],
};

export const projectSelectBlockDemoState: ProjectSelectBlockState = {
  projects: [
    {name: 'Supafan', color: '#3b82f6', directories: [filmProjects.supafan]},
    {name: 'Acme Tools', color: '#10b981', directories: [filmProjects.launch]},
  ],
};

export const projectSelectRespondedState: ProjectSelectBlockState = {
  disabled: true,
  displayText: 'Selected project:',
  response: filmProjects.supafan,
  projects: [
    {name: 'Supafan', color: '#3b82f6', directories: [filmProjects.supafan]},
  ],
};

export const chatComposerStatusLineDemoState: ChatComposerState = {
  ...launchComposerState,
  chatStatus: {color: '#10b981'},
  statusLine: filmProjectDirectories.agentBuddy.displayPath,
};

export const chatComposerQuickPromptsEditingDemoState: ChatComposerState = {
  ...launchComposerState,
  quickPromptsEditing: true,
  quickPromptsEditingId: 'qp-create-ticket',
  quickPromptsEditingText: 'create the next thread from this plan',
  quickPromptsNewText: 'summarize the PR launch notes',
  quickPromptsOpen: true,
};

export const chatComposerRevertHistoryDemoState: ChatComposerState = {
  ...launchComposerState,
  revertHistory: {
    messages: [
      {id: 'm1', text: 'Turn the launch notes into a plan and create execution tickets.', createdAt: '9:32 AM', canSummarize: false},
      {id: 'm2', text: 'Use the screenshot and current tasklist to write a launch brief.', createdAt: '9:41 AM', canSummarize: true},
      {id: 'm3', text: 'Polish the checkout flow and prepare the PR path.', createdAt: '9:58 AM', canSummarize: true, selected: true},
    ],
  },
};

export const chatComposerRevertActionsDemoState: ChatComposerState = {
  ...launchComposerState,
  revertHistory: {
    level: 'actions',
    messages: [
      {id: 'm1', text: 'Turn the launch notes into a plan and create execution tickets.', createdAt: '9:32 AM', canSummarize: false},
    ],
    selectedAction: 'summarize-from-here',
    selectedMessageId: 'm1',
  },
};

export const chatComposerCommandActiveDemoState: ChatComposerState = {
  ...launchComposerState,
  commandActive: true,
  text: '/launch-film',
};

export const chatComposerDropActiveDemoState: ChatComposerState = {
  ...launchComposerState,
  dropActive: true,
  attachments: [{type: 'file', label: 'release-brief.md'}],
};

export const chatComposerBusyRecordingDemoState: ChatComposerState = {
  ...launchComposerState,
  busy: true,
  recording: true,
};

export const chatComposerCommandSuggestionDemoState: ChatComposerState = {
  ...launchComposerState,
  commandActive: true,
  commandSuggestion: {
    activeIndex: 1,
    anchorCharacterIndex: 1,
    query: 'la',
    suggestions: [
      {name: 'launch-film'},
      {name: 'launch-plan'},
      {name: 'load-context'},
    ],
  },
  text: '/la',
};

export const chatComposerCommandSuggestionEmptyDemoState: ChatComposerState = {
  ...launchComposerState,
  commandActive: true,
  commandSuggestion: {
    anchorCharacterIndex: 1,
    query: 'zz',
    suggestions: [],
  },
  text: '/zz',
};

export const chatComposerReferenceCategoriesDemoState: ChatComposerState = {
  ...launchComposerState,
  referenceAutocomplete: {
    anchorCharacterIndex: 4,
    categoryQuery: '',
    level: 'category',
    query: '',
    selectedIndex: 2,
    selectedCategory: null,
    suggestions: referenceCategorySuggestions(),
  },
  text: 'Use #',
};

export const chatComposerReferenceFilteredCategoriesDemoState: ChatComposerState = {
  ...launchComposerState,
  referenceAutocomplete: {
    anchorCharacterIndex: 4,
    categoryQuery: '',
    level: 'category',
    query: 'no',
    selectedCategory: null,
    suggestions: referenceCategorySuggestions('no'),
  },
  text: 'Use #no',
};

export const chatComposerReferencesDemoState: ChatComposerState = {
  ...launchComposerState,
  referenceAutocomplete: {
    anchorCharacterIndex: 4,
    categoryQuery: 'notes:',
    level: 'items',
    query: 'current',
    selectedCategory: 'notes',
    suggestions: [
      {id: 'notes-current', label: 'current', shortCode: 'notes-current', type: 'note'},
      {id: 'notes-tasklist', label: 'Tasklist', shortCode: 'notes-tasklist', type: 'tasklist'},
    ],
  },
  content: [
    {type: 'text', text: 'Use '},
    {type: 'reference', refId: 'notes-current', label: 'current', refType: 'note', shortCode: 'notes-current'},
    {type: 'text', text: ' and this screenshot to turn launch context into tickets.'},
  ],
  text: 'Use current and this screenshot to turn launch context into tickets.',
};

export const chatComposerThreadReferenceItemsDemoState: ChatComposerState = {
  ...launchComposerState,
  referenceAutocomplete: {
    anchorCharacterIndex: 4,
    categoryQuery: 'threads:',
    level: 'items',
    query: 'launch',
    selectedCategory: 'threads',
    suggestions: [
      {id: 'thread-launch', label: 'Launch PR implementation', shortCode: 'AB-104', type: 'thread'},
      {id: 'thread-checkout', label: 'Polish checkout UI', shortCode: 'AB-123', type: 'thread'},
    ],
  },
  text: 'Use #threads:launch',
};

export const chatComposerDocumentReferenceItemsDemoState: ChatComposerState = {
  ...launchComposerState,
  referenceAutocomplete: {
    anchorCharacterIndex: 4,
    categoryQuery: 'library:',
    level: 'items',
    query: 'launch',
    selectedCategory: 'documents',
    suggestions: [
      {id: 'doc-release', label: 'Release brief', shortCode: 'release-brief', type: 'document'},
      {id: 'folder-assets', label: 'Launch assets', shortCode: 'launch-assets', type: 'folder'},
    ],
  },
  text: 'Use #library:launch',
};

export const chatComposerReferencePillsDemoState: ChatComposerState = {
  ...launchComposerState,
  content: [
    {type: 'text', text: 'Use '},
    {type: 'reference', refId: 'thread-launch', label: 'Launch PR implementation', refType: 'thread', shortCode: 'launch-pr'},
    {type: 'text', text: ' '},
    {type: 'reference', refId: 'doc-brief', label: 'Release brief', refType: 'document', shortCode: 'brief'},
    {type: 'text', text: ' '},
    {type: 'reference', refId: 'folder-assets', label: 'Launch assets', refType: 'folder', shortCode: 'assets'},
    {type: 'text', text: ' '},
    {type: 'reference', refId: 'note-current', label: 'current', refType: 'note', shortCode: 'notes-current'},
    {type: 'text', text: ' '},
    {type: 'reference', refId: 'task-copy', label: 'Write launch copy', refType: 'task', shortCode: 'copy'},
    {type: 'text', text: ' '},
    {type: 'reference', refId: 'tasklist-root', label: 'Tasklist', refType: 'tasklist', shortCode: 'notes-tasklist'},
  ],
  text: 'Use Launch PR implementation Release brief Launch assets current Write launch copy Tasklist',
};

export const chatComposerReferenceEmptyCategoryDemoState: ChatComposerState = {
  ...launchComposerState,
  referenceAutocomplete: {
    anchorCharacterIndex: 4,
    categoryQuery: '',
    level: 'category',
    query: 'zzz',
    selectedCategory: null,
    suggestions: [],
  },
  text: 'Use #zzz',
};

export const chatComposerReferenceEmptyItemsDemoState: ChatComposerState = {
  ...launchComposerState,
  referenceAutocomplete: {
    anchorCharacterIndex: 4,
    categoryQuery: 'notes:',
    level: 'items',
    query: 'zzz',
    selectedCategory: 'notes',
    suggestions: [],
  },
  text: 'Use #notes:zzz',
};

export const chatComposerRecentThreadsDemoBaseState: ChatComposerState = {
  ...launchComposerState,
  bottomTabs: {
    active: 'recent',
    activeLabel: 'Supafan checkout flow',
    pressed: 'recent',
    recentThreadsMenu: {
      currentId: 'launch-plan',
      selectedIndex: 0,
      threadStates: {
        'launch-dev-complete': {color: '#22c55e'},
        'launch-plan': {busy: true},
        'release-checks': {color: '#f59e0b'},
      },
      threads: [
        {id: 'launch-dev-complete', topic: 'Launch PR implementation', pinned: true, shortCode: 'AB-104', timestamp: recentThreadTimestamps.now},
        {id: 'launch-plan', topic: 'Launch Operating Plan', shortCode: 'AB-101', timestamp: recentThreadTimestamps.twoMinutesAgo},
        {id: 'release-checks', topic: 'Release checklist', shortCode: 'AB-118', timestamp: recentThreadTimestamps.eightMinutesAgo},
      ],
    },
  },
};

export const chatComposerRecentThreadsEmptyDemoBaseState: ChatComposerState = {
  ...launchComposerState,
  bottomTabs: {
    active: 'recent',
    activeLabel: 'Supafan checkout flow',
    pressed: 'recent',
    recentThreadsMenu: {
      threads: [],
    },
  },
};

export const chatComposerRecentThreadsRenameDemoBaseState: ChatComposerState = {
  ...chatComposerRecentThreadsDemoBaseState,
  bottomTabs: {
    ...chatComposerRecentThreadsDemoBaseState.bottomTabs!,
    recentThreadsMenu: {
      ...chatComposerRecentThreadsDemoBaseState.bottomTabs!.recentThreadsMenu!,
      contextMenu: {
        threadId: 'launch-plan',
      },
      editingName: 'Launch Operating Plan',
      editingThreadId: 'launch-plan',
    },
  },
};

export const chatComposerActiveThreadRenameDemoState: ChatComposerState = {
  ...launchComposerState,
  bottomTabs: {
    active: 'active',
    activeEditing: true,
    activeLabel: 'Supafan checkout flow',
    pressed: 'active',
  },
};

export const chatComposerNewThreadProjectMenuDemoBaseState: ChatComposerState = {
  ...launchComposerState,
  bottomTabs: {
    active: 'new',
    activeLabel: 'Supafan checkout flow',
    newThreadMenu: {
      openSubmenu: 'project',
      projects: [
        {name: 'Supafan', color: '#38bdf8', directories: [filmProjectDirectories.supafan.path]},
        {name: 'Supafan main', color: '#a78bfa', directories: [`${filmProjectDirectories.supafan.path}-main`]},
      ],
      threads: [],
    },
    pressed: 'new',
  },
};

export const chatComposerNewThreadChildMenuDemoBaseState: ChatComposerState = {
  ...launchComposerState,
  bottomTabs: {
    active: 'new',
    activeLabel: 'Supafan checkout flow',
    newThreadMenu: {
      openSubmenu: 'child',
      projects: [],
      threads: [
        {id: 'launch-plan', shortCode: 'AB-104', timestamp: recentThreadTimestamps.now, topic: 'Launch Operating Plan'},
        {id: 'release-checks', shortCode: 'AB-118', timestamp: recentThreadTimestamps.twoMinutesAgo, topic: 'Release checklist'},
        {id: 'checkout-polish', shortCode: 'AB-123', timestamp: recentThreadTimestamps.eightMinutesAgo, topic: 'Polish checkout UI'},
      ],
    },
    pressed: 'new',
  },
};

export const fullMarkdownViewerDemoContent = [
  '# Launch notes',
  '',
  'Open [Tasklist](tasklist://tasklist-current) and attach it to [Launch PR implementation](thread://launch-pr).',
  '',
  '- [x] Capture launch context',
  '- [ ] Ship release automation',
  '',
  '```ts',
  'const surface = "Supafan";',
  '```',
].join('\n');

export function chatComposerMixedAttachmentsDemoState(previewUrl: string): ChatComposerState {
  return {
    ...launchComposerState,
    attachments: [
      {
        type: 'file',
        label: 'release-brief.md',
        typeLabel: 'Document',
      },
      {
        type: 'image',
        label: 'launch-plan.png',
        previewUrl,
      },
    ],
  };
}

export type ChatTargetId =
  | 'sendButton'
  | 'queueSendButton'
  | 'approvePlanPrimary'
  | 'recentThreads'
  | 'recentThreadRowFirst'
  | 'quickPromptsButton'
  | 'quickPromptFirst'
  | 'quickPromptSend'
  | 'threadsBreadcrumb';

// THE single source of truth for the chat thread's pointer interactions.
// The cursor (in the scene) and every composer state below derive from this
// one list, so a click and the element it acts on can never disagree.
// Frames are source frames; the simple film appends the breadcrumb-nav step.
export const chatInteractionScript: InteractionStep<ChatTargetId>[] = [
  // The prompt finishes typing at ~263 (revealText of the sentence from 168);
  // the cursor only starts travelling to Send after that, so the click never
  // lands before the message is fully typed.
  {label: 'send', start: 264, end: 282, to: 'sendButton', fromViewport: [0.52, 0.53]},
  // While the agent is busy responding, the user types a follow-up and clicks
  // Send again — it queues (same Send button, distinct target so it doesn't
  // move the first send's click frame). The cursor is parked on Send from the
  // first click, so this is an in-place press at the same rect.
  {label: 'queue-send', start: 338, end: 350, to: 'queueSendButton', from: 'sendButton', fromPoint: {anchor: [0.5, 0.5]}, toPoint: {anchor: [0.5, 0.5]}},
  {label: 'approach-approve', start: 370, end: 396, to: 'approvePlanPrimary', from: 'sendButton', click: false, toPoint: {anchor: [0.42, 0.5]}},
  {label: 'approve-plan', start: 400, end: 414, to: 'approvePlanPrimary', from: 'approvePlanPrimary', fromPoint: {anchor: [0.42, 0.5]}, toPoint: {anchor: [0.42, 0.5]}},
  {label: 'open-recent', start: 424, end: 454, to: 'recentThreads', from: 'approvePlanPrimary', fromPoint: {anchor: [0.42, 0.5]}, toPoint: {anchor: [0.42, 0.5]}, opens: 'recentMenu'},
  {label: 'reach-row', start: 462, end: 482, to: 'recentThreadRowFirst', from: 'recentThreads', fromPoint: {anchor: [0.42, 0.5]}, toPoint: {anchor: [0.14, 0.68]}, click: false},
  {label: 'hover-row', start: 486, end: 506, to: 'recentThreadRowFirst', from: 'recentThreadRowFirst', fromPoint: {anchor: [0.14, 0.68]}, toPoint: {anchor: [0.14, 0.68]}, click: false},
  {label: 'select-row', start: 508, end: 526, to: 'recentThreadRowFirst', from: 'recentThreadRowFirst', fromPoint: {anchor: [0.14, 0.68]}, toPoint: {anchor: [0.14, 0.68]}, closes: 'recentMenu'},
  {label: 'open-quick-prompts', start: 540, end: 550, to: 'quickPromptsButton', from: 'recentThreadRowFirst', fromPoint: {anchor: [0.14, 0.68]}, opens: 'quickPromptsMenu'},
  {label: 'reach-quick-item', start: 554, end: 570, to: 'quickPromptFirst', from: 'quickPromptsButton', toPoint: {anchor: [0.25, 0.5]}, click: false},
  {label: 'select-quick-item', start: 574, end: 586, to: 'quickPromptFirst', from: 'quickPromptFirst', fromPoint: {anchor: [0.25, 0.5]}, toPoint: {anchor: [0.25, 0.5]}, closes: 'quickPromptsMenu'},
  {label: 'send-quick-prompt', start: 604, end: 624, to: 'quickPromptSend', from: 'quickPromptFirst', fromPoint: {anchor: [0.25, 0.5]}},
];

export const chatInteractions = createInteractionModel(chatInteractionScript);

// Click frames, read once from the script. Downstream beats are expressed as
// offsets from these, never as free-floating numbers.
const sendClickFrame = chatInteractions.clickFrame('sendButton')!;
const queueSendClickFrame = chatInteractions.clickFrame('queueSendButton')!;
const approveClickFrame = chatInteractions.clickFrame('approvePlanPrimary')!;
const recentRowClickFrame = chatInteractions.clickFrame('recentThreadRowFirst')!;
const quickSelectClickFrame = chatInteractions.clickFrame('quickPromptFirst')!;
const quickSendClickFrame = chatInteractions.clickFrame('quickPromptSend')!;

// The composer commits the typed prompt exactly when the click completes —
// the bubble appears, the field clears, the button disables together.
const promptSentFrame = sendClickFrame;                           // 282

// A second message the user types while the agent is busy, then queues. It
// types in the composer after the first send and commits (clears + appears as
// a "Queued" bubble at the bottom) when the queue-send click lands.
const queuedMessageText = 'Also add refund and dispute handling.';
const queuedTypeStart = 300;
const queuedMessageSentFrame = queueSendClickFrame;               // 350

// Geometric pointer supplied by the scene: whether the real cursor sprite is
// over / pressing an element. Visual states (press, row highlight) read from
// this so they match the rendered cursor pixel-for-pixel. Effects (menu open,
// message sent) stay frame-timed because they fire on click completion.
export type ChatPointer = {
  over: (target: ChatTargetId) => boolean;
  pressing: (target: ChatTargetId) => boolean;
};
const planApprovalEnd = approveClickFrame + 6;                    // 420
const approvedSummaryStart = approveClickFrame + 18;             // 432
const planToolActivityStart = approveClickFrame + 30;           // 444
const recentThreadLoadedStart = recentRowClickFrame + 6;        // 532
const quickPromptTextStart = quickSelectClickFrame + 10;        // 596
const quickPromptSentFrame = quickSendClickFrame + 2;           // 626
const quickPromptResponseStart = 660;
const noteReferenceSelectStart = 112;
const noteReferenceSelectEnd = 144;
const noteReferenceInsertFrame = 152;
// The prompt types via the central `revealText` (type cadence): the prefix
// finishes ~frame 35 and holds with the autocomplete menu open until the
// selection animates at SelectStart; the sentence resumes after the
// reference is inserted. These boundaries gate the autocomplete, not the
// reveal rate.
const promptAfterReferenceStart = 168;

export function toolActivityViewForFrame(frame: number) {
  return {
    rowOpacities: chatToolActivity.entries.map((_, index) => ease(frame, 234 + index * 14, 250 + index * 14)),
    state: frame > 290 ? {...chatToolActivity, state: 'done' as const} : chatToolActivity,
  };
}

export function completedDevThreadActivityViewForFrame(frame: number) {
  return {
    rowOpacities: completedDevThreadActivity.entries.map((_, index) => ease(frame, recentThreadLoadedStart + 8 + index * 8, recentThreadLoadedStart + 20 + index * 8)),
    state: completedDevThreadActivity,
  };
}

function typedPromptForFrame(frame: number) {
  const prefix = 'Use #notes:';
  const insertedReferenceText = 'Use #notes:tasklist ';
  const remainingText = chatShotState.prompt.text.slice(insertedReferenceText.length);
  if (frame < noteReferenceSelectEnd) {
    return revealText(prefix, frame, chatShotState.prompt.from);
  }
  if (frame < promptAfterReferenceStart) return insertedReferenceText;
  return insertedReferenceText + revealText(remainingText, frame, promptAfterReferenceStart);
}

export function chatViewForFrame(frame: number) {
  const quickPromptSent = frame >= quickPromptSentFrame;
  const sentUserMessageStyle = frame >= promptSentFrame
    ? {opacity: 1, transform: 'translateY(0px)'}
    : {opacity: 0, transform: 'translateY(0px)'};
  const messageReveal = (from: number) => {
    const progress = ease(frame, from, from + 18);
    return {
      opacity: progress,
      transform: `translateY(${(1 - progress) * 18}px)`,
    };
  };
  return {
    prompt: typedPromptForFrame(frame),
    promptCaretVisible: frame < chatShotState.prompt.caretUntil,
    response: revealText(chatShotState.response.text, frame, chatShotState.response.from, 'stream'),
    conversationOpacity: ease(frame, 272, 302),
    conversationY: 28 - ease(frame, 272, 302) * 28,
    messageStyles: {
      assistant: messageReveal(250),
      system: messageReveal(210),
      user: quickPromptSent ? messageReveal(quickPromptSentFrame) : sentUserMessageStyle,
    },
    toolActivity: undefined,
  };
}

export function chatShotViewForFrame(frame: number, pointer?: ChatPointer): ChatShotView {
  // Press/hover come from the real cursor geometry when the scene provides it;
  // a frame-timed fallback keeps non-geometric callers (e.g. audits) working.
  const over = (target: ChatTargetId) => pointer ? pointer.over(target) : chatInteractions.hovered(target, frame);
  const pressing = (target: ChatTargetId) => pointer ? pointer.pressing(target) : chatInteractions.pressed(target, frame);
  const view = chatViewForFrame(frame);
  const imageAttachmentEnter = ease(frame, 188, 204);
  const recentThreadLoaded = frame >= recentThreadLoadedStart;
  const showInitialThinking = frame >= 282 && frame < planApprovalEnd;
  const showInitialResponse = frame >= 306 && frame < planApprovalEnd;
  const showPlan = frame >= 370 && frame < planApprovalEnd;
  const showPlanApproval = frame >= 382 && frame < planApprovalEnd;
  const showApprovedSummary = frame >= approvedSummaryStart && frame < recentThreadLoadedStart;
  const showPlanToolActivity = frame >= planToolActivityStart && frame < recentThreadLoadedStart;
  const quickPromptSent = frame >= quickPromptSentFrame;
  const showQuickPromptResponse = frame > quickPromptResponseStart;
  const referenceStartIndex = 'Use '.length;
  const referenceCompleteText = 'Use #notes:tasklist ';
  const referenceTokenText = 'Use #notes:tasklist';
  const selectedNoteReference = view.prompt.startsWith(referenceCompleteText);
  const typedReferenceText = referenceTextFromPrompt(view.prompt);
  const noteReferencePromptContent: ChatComposerInlineNode[] | undefined = selectedNoteReference
    ? [
        {type: 'text', text: 'Use '},
        {type: 'reference', refId: 'notes-tasklist', label: 'Tasklist', refType: 'tasklist', shortCode: 'notes-tasklist'},
        {type: 'text', text: view.prompt.slice(referenceTokenText.length)},
      ]
    : undefined;
  const referenceAutocomplete = typedReferenceText && !selectedNoteReference
    ? typedReferenceText.startsWith('notes:')
      ? {
          anchorCharacterIndex: referenceStartIndex,
          categoryQuery: 'notes:',
          level: 'items' as const,
          query: typedReferenceText.slice('notes:'.length),
          selectedIndex: frame >= noteReferenceSelectStart ? 1 : 0,
          selectedCategory: 'notes' as const,
          suggestions: [
            {id: 'notes-current', label: 'current', shortCode: 'notes-current', type: 'note' as const},
            {id: 'notes-tasklist', label: 'Tasklist', shortCode: 'notes-tasklist', type: 'tasklist' as const},
          ],
        }
      : {
          anchorCharacterIndex: referenceStartIndex,
          categoryQuery: '',
          level: 'category' as const,
          query: typedReferenceText,
          selectedCategory: null,
          suggestions: referenceCategorySuggestions(typedReferenceText),
        }
    : undefined;
  const stableLoadedMessageStyles = {
    assistant: {
      opacity: 1,
      transform: 'translateY(0px)',
    },
    system: {
      opacity: 0,
      transform: 'translateY(0px)',
    },
    user: {
      opacity: 1,
      transform: 'translateY(0px)',
    },
  };
  return {
    breadcrumbs: recentThreadLoaded ? ['Threads', launchFilmStory.threads.stripePaymentIntegration.title] : chatShotState.breadcrumbs,
    composer: {
      ...launchComposerState,
      referenceAutocomplete,
      content: frame < promptSentFrame ? noteReferencePromptContent : undefined,
      attachments: [
        ...(frame > 188 && frame < promptSentFrame ? [{
          type: 'image' as const,
          label: 'checkout mockup',
          previewUrl: launchCheckoutMockupPreviewUrl,
          style: {
            opacity: imageAttachmentEnter,
            transform: `translateY(${mix(10, 0, imageAttachmentEnter)}px) scale(${mix(0.975, 1, imageAttachmentEnter)})`,
          },
        }] : []),
      ],
      bottomTabs: frame > 188
        ? {
            ...launchComposerState.bottomTabs!,
            activeLabel: recentThreadLoaded ? launchFilmStory.threads.stripePaymentIntegration.title : launchComposerState.bottomTabs!.activeLabel,
            // Tab is "recent" while the recent menu is up, "active" once the
            // chosen thread loads — both derived from the cursor's clicks.
            active: recentThreadLoaded ? 'active' : chatInteractions.clicked('recentThreads', frame) ? 'recent' : frame > 150 ? 'active' : undefined,
            pressed: pressing('recentThreads')
                ? 'recent'
                : pressing('recentThreadRowFirst') || pressing('quickPromptSend')
                  ? 'active'
                  : undefined,
            recentThreadsMenu: chatInteractions.opened('recentMenu', frame)
              ? {
                  currentId: launchFilmStory.threads.checkoutImplementation.id,
                  // Highlighted exactly while the cursor sprite is over the row.
                  selectedIndex: over('recentThreadRowFirst') ? 0 : -1,
                  threadStates: {
                    [launchFilmStory.threads.stripePaymentIntegration.id]: {color: '#22c55e'},
                    [launchFilmStory.threads.checkoutImplementation.id]: {busy: true},
                    [launchFilmStory.threads.deployChecklist.id]: {color: '#f59e0b'},
                  },
                  threads: [
                    {id: launchFilmStory.threads.stripePaymentIntegration.id, topic: launchFilmStory.threads.stripePaymentIntegration.title, pinned: true, shortCode: launchFilmStory.threads.stripePaymentIntegration.shortCode, timestamp: recentThreadTimestamps.now},
                    {id: launchFilmStory.threads.checkoutImplementation.id, topic: launchFilmStory.threads.checkoutImplementation.title, shortCode: launchFilmStory.threads.checkoutImplementation.shortCode, timestamp: recentThreadTimestamps.twoMinutesAgo},
                    {id: launchFilmStory.threads.deployChecklist.id, topic: launchFilmStory.threads.deployChecklist.title, shortCode: launchFilmStory.threads.deployChecklist.shortCode, timestamp: recentThreadTimestamps.eightMinutesAgo},
                  ],
                }
              : undefined,
          }
        : undefined,
      referenceButtonPressed: Boolean(typedReferenceText && !selectedNoteReference),
      quickPromptsButtonPressed: pressing('quickPromptsButton'),
      quickPromptsOpen: chatInteractions.opened('quickPromptsMenu', frame),
      quickPromptsSelectedIndex: over('quickPromptFirst') ? 0 : undefined,
      sendPressed: pressing('sendButton') || pressing('queueSendButton') || pressing('quickPromptSend'),
      text: frame >= chatShotState.prompt.from && frame < promptSentFrame
        ? view.prompt
        : frame >= queuedTypeStart && frame < queuedMessageSentFrame
          ? revealText(queuedMessageText, frame, queuedTypeStart)
          : frame >= quickPromptTextStart && frame < quickSendClickFrame
            ? reviewQuickPromptText
            : undefined,
    },
    conversation: {
      additionalAssistantMessages: [
        ...(showPlan ? [{
          approval: showPlanApproval ? launchPlanApprovalState : undefined,
          markdown: '',
          markdownBlock: {label: 'Plan', content: launchPlanMarkdown},
          promptBlock: showPlanApproval ? {content: 'Approve this plan and start implementing?'} : undefined,
          style: {
            opacity: ease(frame, 370, 382),
            transform: `translateY(${(1 - ease(frame, 370, 382)) * 18}px)`,
          },
        }] : []),
        ...(showApprovedSummary ? [{
          autoHide: true,
          markdown: 'Approved checkout implementation plan - work started',
          style: {
            opacity: ease(frame, approvedSummaryStart, approvedSummaryStart + 10),
            transform: `translateY(${(1 - ease(frame, approvedSummaryStart, approvedSummaryStart + 10)) * 12}px)`,
          },
        }] : []),
        ...(showPlanToolActivity ? [{
          markdown: '',
          style: {
            opacity: ease(frame, planToolActivityStart, planToolActivityStart + 14),
            transform: `translateY(${(1 - ease(frame, planToolActivityStart, planToolActivityStart + 14)) * 18}px)`,
          },
          toolActivity: {
            rowOpacities: chatToolActivity.entries.map((_, index) => ease(frame, planToolActivityStart + 2 + index * 8, planToolActivityStart + 14 + index * 8)),
            state: chatToolActivity,
          },
        }] : []),
      ],
      assistant: {
        approval: undefined,
        markdown: showQuickPromptResponse
          ? view.response
          : recentThreadLoaded
            ? completedDevThreadResponse
            : showInitialResponse
              ? view.response
              : '',
        markdownBlock: undefined,
        markdownStyle: showInitialResponse && !recentThreadLoaded && !showQuickPromptResponse
          ? {opacity: ease(frame, 306, 314)}
          : undefined,
        promptBlock: undefined,
        thinking: showInitialThinking ? {
          defaultOpen: true,
          label: 'Thinking',
          state: frame >= chatShotState.response.from ? 'done' : 'streaming',
          content: 'Examining the tasklist and screenshot to identify the checkout components and determine the right Stripe integration pattern before creating tickets.',
        } : undefined,
        thinkingStyle: showInitialThinking ? {
          opacity: ease(frame, 282, 290),
          transform: `translateY(${(1 - ease(frame, 282, 290)) * 10}px)`,
        } : undefined,
        toolActivity: recentThreadLoaded && !showQuickPromptResponse
          ? completedDevThreadActivityViewForFrame(frame)
          : undefined,
      },
      createdAt: chatShotState.createdAt,
      systemMessage: chatShotState.systemMessage,
      userMessage: {
        caretVisible: frame < promptSentFrame && view.promptCaretVisible,
        content: showQuickPromptResponse || recentThreadLoaded ? undefined : noteReferencePromptContent,
        text: quickPromptSent ? reviewQuickPromptText : recentThreadLoaded ? 'Polish the checkout flow and prepare the PR path.' : view.prompt,
      },
      // Queued follow-up: sits at the bottom of the conversation from the
      // queue-send click until the thread is switched away via recent threads.
      queuedMessage: frame >= queuedMessageSentFrame && !recentThreadLoaded && !showQuickPromptResponse
        ? {text: queuedMessageText}
        : undefined,
    },
    conversationStyle: {
      opacity: view.conversationOpacity,
      transform: `translateY(${view.conversationY}px)`,
    },
    messageStyles: recentThreadLoaded && !showQuickPromptResponse ? stableLoadedMessageStyles : view.messageStyles,
  };
}

function referenceTextFromPrompt(prompt: string) {
  const hashIndex = prompt.indexOf('#');
  if (hashIndex === -1) return '';
  const afterHash = prompt.slice(hashIndex + 1);
  if (!afterHash) return '';
  return afterHash.split(/\s/, 1)[0] ?? '';
}
