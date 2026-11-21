import type {ActionCategory} from '../../agentbuddy-ui/actions/actionTypes';
import type {PromptEntity, PromptsSurfaceState} from '../../agentbuddy-ui/prompts/promptTypes';

export const promptCategories: ActionCategory[] = [
  {name: 'text-processing', color: '#60a5fa'},
  {name: 'development', color: '#4ade80'},
  {name: 'assistant', color: '#c084fc'},
  {name: 'analysis', color: '#fb923c'},
  {name: 'creative', color: '#f472b6'},
  {name: 'formatting', color: '#22d3ee'},
];

const launchPromptTemplate = `const { productName, audience, tone } = params;

return \`
You are preparing launch copy for \${productName}.

Audience:
\${audience}

Tone:
\${tone}

Write:
- a concise positioning statement
- three launch bullets
- a short social post
\`;`;

const prompts: PromptEntity[] = [
  {
    category: 'creative',
    createdAt: 1769362240000,
    description: 'Turns product context into launch positioning, bullets, and social copy.',
    id: 'prompt_launch_copy',
    inputs: {
      productName: {description: 'Name of the product or feature', name: 'productName', required: true, type: 'string'},
      audience: {description: 'Primary buyer or user audience', name: 'audience', required: true, type: 'string'},
      tone: {description: 'Desired writing tone', name: 'tone', required: false, type: 'string'},
    },
    label: 'Launch copy brief',
    outputSchema: '{\n  "type": "object",\n  "properties": {\n    "positioning": {"type": "string"},\n    "bullets": {"type": "array"},\n    "post": {"type": "string"}\n  }\n}',
    templateFn: launchPromptTemplate,
    updatedAt: 1769448640000,
  },
  {
    category: 'development',
    createdAt: 1769275840000,
    description: 'Summarizes implementation context into a compact code review checklist.',
    id: 'prompt_code_review',
    inputs: {
      diff: {description: 'Code diff to review', name: 'diff', required: true, type: 'string'},
      risk: {description: 'Risk area to focus on', name: 'risk', required: false, type: 'string'},
    },
    label: 'Code review checklist',
    templateFn: 'const { diff, risk } = params;\\nreturn `Review this diff with focus on ${risk}:\\n\\n${diff}`;',
    updatedAt: 1769369440000,
  },
  {
    category: 'analysis',
    createdAt: 1769189440000,
    description: 'Extracts launch blockers and next actions from meeting notes.',
    id: 'prompt_launch_risks',
    inputs: {
      notes: {description: 'Meeting notes or thread summary', name: 'notes', required: true, type: 'string'},
    },
    label: 'Launch risk summary',
    templateFn: 'const { notes } = params;\\nreturn `Find launch risks and next actions in these notes:\\n${notes}`;',
    updatedAt: 1769362240000,
  },
];

export const promptsListState: PromptsSurfaceState = {
  categories: promptCategories,
  hasMore: false,
  hasPrompts: true,
  loadingMore: false,
  prompts,
  selectedCategories: [],
  view: 'list',
};

export const promptsFilteredState: PromptsSurfaceState = {
  ...promptsListState,
  categoryFilterOpen: true,
  prompts: prompts.filter(prompt => prompt.category === 'development'),
  selectedCategories: ['development'],
};

export const promptsLoadingMoreState: PromptsSurfaceState = {
  ...promptsListState,
  hasMore: true,
  loadingMore: true,
};

export const promptsEmptyState: PromptsSurfaceState = {
  categories: promptCategories,
  hasMore: false,
  hasPrompts: false,
  loadingMore: false,
  prompts: [],
  selectedCategories: [],
  view: 'list',
};

export const promptCreateState: PromptsSurfaceState = {
  categories: promptCategories,
  formData: {
    category: '',
    description: '',
    inputs: {},
    label: '',
    outputSchema: '',
    templateFn: '',
  },
  inputsExpanded: true,
  metadataExpanded: true,
  outputExpanded: false,
  view: 'create',
};

const selectedPrompt = prompts[0];

export const promptDetailState: PromptsSurfaceState = {
  categories: promptCategories,
  expandedInputKeys: ['productName'],
  formData: {
    category: selectedPrompt.category,
    description: selectedPrompt.description,
    inputs: selectedPrompt.inputs,
    label: selectedPrompt.label,
    outputSchema: selectedPrompt.outputSchema,
    templateFn: selectedPrompt.templateFn,
  },
  inputsExpanded: true,
  metadataExpanded: true,
  outputExpanded: true,
  prompt: selectedPrompt,
  view: 'detail',
};

export const promptCollapsedSectionsState: PromptsSurfaceState = {
  ...promptDetailState,
  expandedInputKeys: [],
  inputsExpanded: false,
  metadataExpanded: false,
  outputExpanded: false,
};

export function promptsSurfaceStateForFrame(frame: number): PromptsSurfaceState {
  return frame < 90 ? promptsListState : promptDetailState;
}
