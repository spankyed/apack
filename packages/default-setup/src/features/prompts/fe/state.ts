import type { OutcomeOf, Read, Value } from '@apackdev/state';
import type { OpenEntity } from '@apackdev/sdk/events';
import { entityIs, type SurfaceChrome, type TrailClickEvent } from '@apackdev/sdk/fe';
import type { PromptEntity, TemplateInput } from '@apackdev/sdk';
import { Trash2 } from 'lucide-vue-next';
import type { EARS } from '#generated/ears.ts';
import { state, type PackNet } from '#generated/state.ts';
import type { Contract, PromptsContext, PromptsInboxEvent } from './contract.ts';

export const id = 'prompts' as const;

/** How many more prompts the list shows each time the user reaches its end */
export const PROMPTS_PAGE_SIZE = 20;

type PromptsAsks = PackNet['systems']['prompts']['asks'];

type UIEvent =
  | { type: 'CLEAR_WRITE_ERROR' }
  | PromptsInboxEvent
  | { type: 'PROMPT.CREATE' }
  | { type: 'PROMPT.SAVE' }
  /**
   * What the open prompt's view read, which the canvas hands on: the prompt, or `null` once it's gone (deleted here
   * or in another window). About the UI, not the data — it fills the form once and keeps the breadcrumb's label.
   */
  | { type: 'PROMPT.LOADED'; promptId: EARS.EntityId; prompt: PromptEntity | null }
  | { type: 'PROMPTS.LOAD_MORE' }
  | { type: 'FORM.UPDATE_CATEGORY'; category: string }
  | { type: 'FORM.UPDATE_LABEL'; label: string }
  | { type: 'FORM.UPDATE_DESCRIPTION'; description: string }
  | { type: 'FORM.UPDATE_INPUTS'; inputs: Record<string, TemplateInput> }
  | { type: 'FORM.UPDATE_TEMPLATE'; templateFn: string }
  | { type: 'FORM.UPDATE_OUTPUT_SCHEMA'; outputSchema: any }
  | { type: 'VIEW_LIST' }
  | { type: 'TOGGLE_INPUTS_SECTION'; show: boolean }
  | { type: 'TOGGLE_OUTPUT_SECTION'; show: boolean }
  | { type: 'TOGGLE_METADATA_SECTION'; show: boolean }
  | { type: 'FILTER.TOGGLE_CATEGORY'; categoryName: string }
  | { type: 'FILTER.CLEAR' }
  /** The settings form's import and export, and the result of each no longer shown */
  | { type: 'PROMPTS.IMPORT'; prompts: unknown }
  | { type: 'PROMPTS.FORGET_IMPORT' }
  | { type: 'PROMPTS.EXPORT'; directory: string }
  | { type: 'PROMPTS.FORGET_EXPORT' };

/** What the machine holds: what the surface publishes, and how the last import and export ended */
type PromptsData = Omit<PromptsContext, 'selectedPromptId' | 'selectedLabel' | 'formFor'> & {
  selectedPromptId: EARS.EntityId | undefined;
  selectedLabel: string | undefined;
  formFor: EARS.EntityId | undefined;
  /** How the last import ended, until another file is picked */
  imported: OutcomeOf<PromptsAsks['IMPORT_PROMPTS']> | undefined;
  /** How the last export ended, until another is made */
  exported: OutcomeOf<PromptsAsks['EXPORT_PROMPTS']> | undefined;
};

type PromptsShape = {
  data: PromptsData;
  calls: {
    createPrompt: { readonly many: PromptsAsks['CREATE_PROMPT']['args'] };
    updatePrompt: { readonly many: PromptsAsks['UPDATE_PROMPT']['args'] };
    deletePrompt: { readonly many: PromptsAsks['DELETE_PROMPT']['args'] };
    importPrompts: { readonly one: PromptsAsks['IMPORT_PROMPTS']['args'] };
    exportPrompts: { readonly one: PromptsAsks['EXPORT_PROMPTS']['args'] };
  };
  states: {
    list: {};
    create: {};
    detail: {};
  };
};

export type PromptsEvents = OpenEntity | UIEvent | TrailClickEvent;

// The list shows no prompt, so reopening one fills its form afresh from what its view reads then
const CLEAR_SELECTED = {
  selectedPromptId: undefined,
  selectedLabel: undefined,
  formFor: undefined,
} as const;

const CREATE_FORM_DATA = {
  label: '',
  description: '',
  category: '',
  inputs: {},
  templateFn: '// Your template function body here\nreturn `Your prompt template`;',
  outputSchema: undefined,
};

function selectPromptData(currentId: EARS.EntityId | undefined, promptId: EARS.EntityId) {
  if (currentId === promptId) return undefined;
  return { selectedPromptId: promptId, selectedLabel: undefined, formFor: undefined };
}

const formUpdateHandlers = {
  'FORM.UPDATE_LABEL': (event: Extract<PromptsEvents, { type: 'FORM.UPDATE_LABEL' }>, { data }: { data: Read<PromptsData> }) => ({
    data: { formData: { ...data.formData, label: event.label } },
  }),
  'FORM.UPDATE_DESCRIPTION': (event: Extract<PromptsEvents, { type: 'FORM.UPDATE_DESCRIPTION' }>, { data }: { data: Read<PromptsData> }) => ({
    data: { formData: { ...data.formData, description: event.description } },
  }),
  'FORM.UPDATE_INPUTS': (event: Extract<PromptsEvents, { type: 'FORM.UPDATE_INPUTS' }>, { data }: { data: Read<PromptsData> }) => ({
    data: { formData: { ...data.formData, inputs: event.inputs } },
  }),
  'FORM.UPDATE_TEMPLATE': (event: Extract<PromptsEvents, { type: 'FORM.UPDATE_TEMPLATE' }>, { data }: { data: Read<PromptsData> }) => ({
    data: { formData: { ...data.formData, templateFn: event.templateFn } },
  }),
  'FORM.UPDATE_OUTPUT_SCHEMA': (event: Extract<PromptsEvents, { type: 'FORM.UPDATE_OUTPUT_SCHEMA' }>, { data }: { data: Read<PromptsData> }) => ({
    data: { formData: { ...data.formData, outputSchema: event.outputSchema } },
  }),
  'FORM.UPDATE_CATEGORY': (event: Extract<PromptsEvents, { type: 'FORM.UPDATE_CATEGORY' }>, { data }: { data: Read<PromptsData> }) => ({
    data: { formData: { ...data.formData, category: event.category } },
  }),
};

export const promptsChrome: SurfaceChrome<Value<PromptsShape>> = {
  default: { label: 'Prompts', target: 'list' },
  states: {
    list: {
      breadcrumb: { label: 'Prompts', target: 'list' },
    },
    create: {
      breadcrumb: { label: 'New Prompt', target: 'create' },
    },
    detail: {
      breadcrumb: ({ data }) => ({
        label: data.selectedLabel || data.selectedPromptId || '',
        target: 'detail',
      }),
      menu: ({ data }) => [
        {
          label: 'Delete Prompt',
          icon: Trash2,
          event: { type: 'PROMPT.DELETE' as const, promptId: data.selectedPromptId! },
          iconColor: 'text-red-400',
          confirm: `Are you sure you want to delete "${data.selectedLabel || 'this prompt'}"?`,
        },
      ],
    },
  },
};

const promptsState = state<PromptsShape, PromptsEvents>()({
  initial: 'list',
  data: {
    selectedPromptId: undefined,
    selectedLabel: undefined,
    formFor: undefined,
    imported: undefined,
    exported: undefined,
    listLimit: PROMPTS_PAGE_SIZE,
    writeError: null,
    selectedCategories: [],
    formData: {
      label: '',
      description: '',
      category: '',
      inputs: {},
      templateFn: '',
      outputSchema: undefined,
    },
  },
  calls: ({ one, many }) => ({
    // What a write changed reaches every window through the views, so a landed one needs nothing here;
    // a refused write is shown until dismissed.
    createPrompt: many('prompts', 'CREATE_PROMPT', {
      done: (outcome) => (outcome.ok ? undefined : { data: { writeError: outcome.failure.message } }),
    }),
    updatePrompt: many('prompts', 'UPDATE_PROMPT', {
      done: (outcome) => (outcome.ok ? undefined : { data: { writeError: outcome.failure.message } }),
    }),
    deletePrompt: many('prompts', 'DELETE_PROMPT', {
      done: (outcome) => (outcome.ok ? undefined : { data: { writeError: outcome.failure.message } }),
    }),
    importPrompts: one('prompts', 'IMPORT_PROMPTS', {
      done: (outcome) => ({ data: { imported: outcome } }),
    }),
    exportPrompts: one('prompts', 'EXPORT_PROMPTS', {
      done: (outcome) => ({ data: { exported: outcome } }),
    }),
  }),
  on: {
    'PROMPTS.IMPORT': (event, { call }) => {
      call('importPrompts', { prompts: event.prompts });
      return { data: { imported: undefined } };
    },
    'PROMPTS.FORGET_IMPORT': () => ({ data: { imported: undefined } }),
    'PROMPTS.EXPORT': (event, { call }) => {
      call('exportPrompts', { directory: event.directory });
      return { data: { exported: undefined } };
    },
    'PROMPTS.FORGET_EXPORT': () => ({ data: { exported: undefined } }),
    CLEAR_WRITE_ERROR: () => ({ data: { writeError: null } }),
    OPEN_ENTITY: (event, { data }) => {
      if (!entityIs<Contract['opens']>({ event }, { entity: 'Prompt' })) return;
      const updates = selectPromptData(data.selectedPromptId, event.id as EARS.EntityId);
      return updates ? { at: 'detail', data: updates } : { at: 'detail' };
    },
    'PROMPT.SELECT': (event, { data }) => {
      const updates = selectPromptData(data.selectedPromptId, event.promptId);
      return updates ? { at: 'detail', data: updates } : { at: 'detail' };
    },
    VIEW_LIST: () => ({ at: 'list', data: CLEAR_SELECTED }),
    TOGGLE_INPUTS_SECTION: (event, { data }) => ({
      data: { formData: { ...data.formData, inputsExpanded: event.show } },
    }),
    TOGGLE_OUTPUT_SECTION: (event, { data }) => ({
      data: { formData: { ...data.formData, outputExpanded: event.show } },
    }),
    TOGGLE_METADATA_SECTION: (event, { data }) => ({
      data: { formData: { ...data.formData, metadataExpanded: event.show } },
    }),
    'PROMPTS.LOAD_MORE': (_event, { data }) => ({
      data: { listLimit: data.listLimit + PROMPTS_PAGE_SIZE },
    }),
    'FILTER.TOGGLE_CATEGORY': (event, { data }) => {
      const categoryName = event.categoryName;
      const isSelected = data.selectedCategories.includes(categoryName);
      return {
        data: {
          selectedCategories: isSelected
            ? data.selectedCategories.filter(c => c !== categoryName)
            : [...data.selectedCategories, categoryName],
        },
      };
    },
    'FILTER.CLEAR': () => ({ data: { selectedCategories: [] } }),
    'PROMPT.UPDATE_INPUTS': (event, { call }) => {
      call('updatePrompt', { promptId: event.promptId, inputs: event.inputs });
    },
    'PROMPT.CREATE_INLINE': (event, { call }) => {
      call('createPrompt', { label: event.label, templateFn: event.templateFn, inputs: event.inputs });
    },
    'PROMPT.UPDATE_LABEL': (event, { call }) => {
      call('updatePrompt', { promptId: event.promptId, label: event.label });
    },
    TRAIL_CLICK: (event) => {
      if (event.target === 'list') return { at: 'list', data: CLEAR_SELECTED };
      if (event.target === 'create') return { at: 'create' };
      if (event.target === 'detail') return { at: 'detail' };
    },
  },
  states: {
    list: {
      on: {
        'PROMPT.CREATE': () => ({
          at: 'create',
          data: {
            formData: CREATE_FORM_DATA,
            ...CLEAR_SELECTED,
          },
        }),
        'PROMPT.DELETE': (event, { call }) => {
          call('deletePrompt', { promptId: event.promptId });
        },
      },
    },
    create: {
      on: {
        ...formUpdateHandlers,
        'PROMPT.SAVE': (_event, { data, call }) => {
          if (!data.selectedPromptId) call('createPrompt', data.formData);
          else call('updatePrompt', { promptId: data.selectedPromptId, ...data.formData });
          return { at: 'list', data: CLEAR_SELECTED };
        },
      },
    },
    detail: {
      on: {
        // The open prompt deleted, here or in another window: there is nothing left to show
        'PROMPT.LOADED': (event, { data }) => {
          if (event.promptId !== data.selectedPromptId) return;
          if (event.prompt === null) return { at: 'list', data: CLEAR_SELECTED };
          // The form is filled once per opening: a change the view brings later (another window's edit) leaves what the
          // user is typing alone, and saving writes the form as it stands
          if (data.formFor === event.promptId) return { data: { selectedLabel: event.prompt.label } };
          return {
            data: {
              selectedLabel: event.prompt.label,
              formFor: event.promptId,
              formData: {
                label: event.prompt.label,
                description: event.prompt.description,
                category: event.prompt.category,
                inputs: event.prompt.inputs,
                templateFn: event.prompt.templateFn,
                outputSchema: event.prompt.outputSchema,
              },
            },
          };
        },
        ...formUpdateHandlers,
        'PROMPT.SAVE': (_event, { data, call }) => {
          if (!data.selectedPromptId) call('createPrompt', data.formData);
          else call('updatePrompt', { promptId: data.selectedPromptId, ...data.formData });
          return { at: 'list', data: CLEAR_SELECTED };
        },
        'PROMPT.DELETE': (event, { call }) => {
          call('deletePrompt', { promptId: event.promptId });
        },
      },
    },
  },
});

export default promptsState;
