import { entityIs } from '@apackdev/sdk/fe'
import type { OpenEntity } from '@apackdev/sdk/events'
import { and, assign, setup, type ActorRefFrom } from 'xstate'
import breadcrumb, { breadcrumbWithParams } from '@apackdev/sdk/fe'
import { safeEvents } from '@apackdev/sdk/fe'
import {
  targetIs,
  TRAIL_CLICK,
  type TrailClickEvent,
} from '@apackdev/sdk/fe'
import type { Contract, PromptsContext, PromptsInboxEvent } from './contract.ts'
import type { OutgoingPromptEvents } from '#features/prompts/be/types.ts'
import type { PromptEntity, TemplateInput } from '@apackdev/sdk'
import type { EARS } from '#generated/ears.ts'
import { sendToSystem } from '#generated/events.ts'
import { Trash2 } from 'lucide-vue-next'
import { contextMenuFn } from '@apackdev/sdk/fe'

/* ─────────────────────────────────────────────────────────── */
/* Machine Types                                               */
/* ─────────────────────────────────────────────────────────── */
export const id = 'prompts' as const;
export type PromptsState = ActorRefFrom<typeof promptsState>

/** How many more prompts the list shows each time the user reaches its end */
export const PROMPTS_PAGE_SIZE = 20

type UIEvent =
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
  // Import/Export events
  | { type: 'PROMPTS.IMPORT'; prompts: any[] }
  | { type: 'PROMPTS.RESET_IMPORT_STATUS' }
  | { type: 'PROMPTS.EXPORT'; directory: string }
  | { type: 'PROMPTS.RESET_EXPORT_STATUS' }

export type PromptsEvents = OpenEntity | UIEvent | OutgoingPromptEvents | TrailClickEvent
const typeOf = safeEvents<PromptsEvents>()

const promptsState = setup({
  types: {
    context: {} as PromptsContext,
    events: {} as PromptsEvents,
  },
  actions: {
    // The list shows no prompt, so reopening one fills its form afresh from what its view reads then
    clearSelectedPrompt: assign({ selectedPromptId: undefined, selectedLabel: undefined, formFor: undefined }),

    /* ── prompt interactions ────────────────────────────── */
    selectPrompt: assign(({ event, context }) => {
      const promptId = event.type === 'OPEN_ENTITY' ? event.id as EARS.EntityId : typeOf('PROMPT.SELECT', event).promptId;
      if (context.selectedPromptId === promptId) return {};
      return { selectedPromptId: promptId, selectedLabel: undefined, formFor: undefined };
    }),

    showLoadedPrompt: assign(({ event, context }) => {
      const { promptId, prompt } = typeOf('PROMPT.LOADED', event);
      if (!prompt) return {};
      // The form is filled once per opening: a change the view brings later (another window's edit) leaves what the
      // user is typing alone, and saving writes the form as it stands
      if (context.formFor === promptId) return { selectedLabel: prompt.label };
      return {
        selectedLabel: prompt.label,
        formFor: promptId,
        formData: {
          label: prompt.label,
          description: prompt.description,
          category: prompt.category,
          inputs: prompt.inputs,
          templateFn: prompt.templateFn,
          outputSchema: prompt.outputSchema,
        },
      };
    }),

    initCreateForm: assign({
      formData: {
        label: '',
        description: '',
        category: '',
        inputs: {},
        templateFn: '// Your template function body here\nreturn `Your prompt template`;',
        outputSchema: undefined,
      },
      selectedPromptId: undefined,
      selectedLabel: undefined,
      formFor: undefined,
    }),

    sendSavePrompt: ({ context }) => {
      // Determine if creating or updating based on selectedPromptId
      const isCreating = !context.selectedPromptId;

      if (isCreating) {
        // Create new prompt
        sendToSystem(id, {
          type: 'CREATE_PROMPT',
          ...context.formData,
        })
      } else {
        // Update existing prompt
        sendToSystem(id, {
          type: 'UPDATE_PROMPT',
          promptId: context.selectedPromptId!,
          ...context.formData,
        })
      }
    },

    sendDeletePrompt: ({ event }) => {
      const ev = typeOf('PROMPT.DELETE', event);
      sendToSystem(id, {
        type: 'DELETE_PROMPT',
        promptId: ev.promptId,
      });
    },

    updatePromptInputs: ({ event }) => {
      const ev = typeOf('PROMPT.UPDATE_INPUTS', event);
      sendToSystem(id, {
        type: 'UPDATE_PROMPT',
        promptId: ev.promptId,
        inputs: ev.inputs,
      });
    },

    createPromptInline: ({ event }) => {
      const ev = typeOf('PROMPT.CREATE_INLINE', event);
      sendToSystem(id, {
        type: 'CREATE_PROMPT',
        label: ev.label,
        templateFn: ev.templateFn,
        inputs: ev.inputs,
      });
    },

    updatePromptLabel: ({ event }) => {
      const ev = typeOf('PROMPT.UPDATE_LABEL', event);
      sendToSystem(id, {
        type: 'UPDATE_PROMPT',
        promptId: ev.promptId,
        label: ev.label,
      });
    },

    /* ── form updates ────────────────────────────────────── */
    updateFormLabel: assign(({ event, context }) => {
      const ev = typeOf('FORM.UPDATE_LABEL', event);
      return {
        formData: {
          ...context.formData,
          label: ev.label,
        },
      };
    }),

    updateFormDescription: assign(({ event, context }) => {
      const ev = typeOf('FORM.UPDATE_DESCRIPTION', event);
      return {
        formData: {
          ...context.formData,
          description: ev.description,
        },
      };
    }),

    updateFormInputs: assign(({ event, context }) => {
      const ev = typeOf('FORM.UPDATE_INPUTS', event);
      return {
        formData: {
          ...context.formData,
          inputs: ev.inputs,
        },
      };
    }),

    updateFormTemplate: assign(({ event, context }) => {
      const ev = typeOf('FORM.UPDATE_TEMPLATE', event);
      return {
        formData: {
          ...context.formData,
          templateFn: ev.templateFn,
        },
      };
    }),

    updateFormOutputSchema: assign(({ event, context }) => {
      const ev = typeOf('FORM.UPDATE_OUTPUT_SCHEMA', event);
      return {
        formData: {
          ...context.formData,
          outputSchema: ev.outputSchema,
        },
      };
    }),

    updateFormCategory: assign(({ event, context }) => {
      const ev = typeOf('FORM.UPDATE_CATEGORY', event);
      return {
        formData: {
          ...context.formData,
          category: ev.category,
        },
      };
    }),

    toggleInputsSection: assign(({ event, context }) => {
      const ev = typeOf('TOGGLE_INPUTS_SECTION', event);
      return {
        formData: {
          ...context.formData,
          inputsExpanded: ev.show,
        },
      };
    }),

    toggleOutputSection: assign(({ event, context }) => {
      const ev = typeOf('TOGGLE_OUTPUT_SECTION', event);
      return {
        formData: {
          ...context.formData,
          outputExpanded: ev.show,
        },
      };
    }),

    toggleMetadataSection: assign(({ event, context }) => {
      const ev = typeOf('TOGGLE_METADATA_SECTION', event);
      return {
        formData: {
          ...context.formData,
          metadataExpanded: ev.show,
        },
      };
    }),

    /* ── Prompts Import actions ────────────────────────────── */
    setImportingPrompts: assign(({ context }) => ({
      promptsImport: {
        ...context.promptsImport,
        status: 'importing' as const,
      },
    })),

    sendImportPrompts: ({ event }) => {
      const ev = typeOf('PROMPTS.IMPORT', event);
      sendToSystem(id, {
        type: 'IMPORT_PROMPTS',
        prompts: ev.prompts,
      });
    },

    handlePromptsImported: assign(({ event }) => {
      const ev = typeOf('PROMPTS_IMPORTED', event);
      return {
        promptsImport: {
          status: 'success' as const,
          errors: ev.errors || [],
          importedCount: ev.count,
        },
      };
    }),

    handlePromptsImportFailed: assign(({ event }) => {
      const ev = typeOf('PROMPTS_IMPORT_FAILED', event);
      return {
        promptsImport: {
          status: 'error' as const,
          errors: ev.errors,
          importedCount: 0,
        },
      };
    }),

    resetImportPromptsStatus: assign({
      promptsImport: { status: 'idle' as const, errors: [], importedCount: 0 },
    }),

    /* ── Prompts Export actions ────────────────────────────── */
    setExportingPrompts: assign(({ context }) => ({
      promptsExport: {
        ...context.promptsExport,
        status: 'exporting' as const,
      },
    })),

    sendExportPrompts: ({ event }) => {
      const ev = typeOf('PROMPTS.EXPORT', event);
      sendToSystem(id, {
        type: 'EXPORT_PROMPTS',
        directory: ev.directory,
      });
    },

    handlePromptsExported: assign(({ event }) => {
      const ev = typeOf('PROMPTS_EXPORTED', event);
      return {
        promptsExport: {
          status: 'success' as const,
          errors: [],
          filePath: ev.filePath,
          promptCount: ev.promptCount,
        },
      };
    }),

    handlePromptsExportFailed: assign(({ event }) => {
      const ev = typeOf('PROMPTS_EXPORT_FAILED', event);
      return {
        promptsExport: {
          status: 'error' as const,
          errors: ev.errors,
          filePath: '',
          promptCount: 0,
        },
      };
    }),

    resetExportPromptsStatus: assign({
      promptsExport: { status: 'idle' as const, errors: [], filePath: '', promptCount: 0 },
    }),

    /* ── the list ─────────────────────────────────────────── */
    showMore: assign(({ context }) => ({ listLimit: context.listLimit + PROMPTS_PAGE_SIZE })),

    /* ── filter actions ──────────────────────────────────── */
    toggleCategoryFilter: assign(({ event, context }) => {
      const ev = typeOf('FILTER.TOGGLE_CATEGORY', event);
      const categoryName = ev.categoryName;
      const isSelected = context.selectedCategories.includes(categoryName);

      return {
        selectedCategories: isSelected
          ? context.selectedCategories.filter(c => c !== categoryName)
          : [...context.selectedCategories, categoryName]
      };
    }),

    clearCategoryFilters: assign({
      selectedCategories: []
    }),
  },
  guards: { entityIs: entityIs<Contract['opens']>,
    targetIs,
    /** Whether what was loaded is the prompt open now, rather than one the user has since moved on from */
    loadsSelected: ({ context, event }) => (event as { promptId?: string }).promptId === context.selectedPromptId,
    /** Whether the open prompt is gone */
    loadsNothing: ({ event }) => (event as { prompt?: unknown }).prompt === null,
  },
}).createMachine({
  id,
  initial: 'list',
  context: {
    selectedPromptId: undefined,
    selectedLabel: undefined,
    formFor: undefined,
    listLimit: PROMPTS_PAGE_SIZE,
    selectedCategories: [], // Filter state
    promptsImport: {
      status: 'idle',
      errors: [],
      importedCount: 0,
    },
    promptsExport: {
      status: 'idle',
      errors: [],
      filePath: '',
      promptCount: 0,
    },
    formData: {
      label: '',
      description: '',
      category: '',
      inputs: {},
      templateFn: '',
      outputSchema: undefined,
    },
  },
  on: {
    OPEN_ENTITY: { guard: { type: 'entityIs', params: { entity: 'Prompt' } }, target: '.detail', actions: 'selectPrompt' },
    'PROMPT.SELECT': { target: '.detail', actions: 'selectPrompt' },
    'VIEW_LIST': {
      target: '.list',
    },
    TOGGLE_INPUTS_SECTION: { actions: 'toggleInputsSection' },
    TOGGLE_OUTPUT_SECTION: { actions: 'toggleOutputSection' },
    TOGGLE_METADATA_SECTION: { actions: 'toggleMetadataSection' },
    'PROMPTS.LOAD_MORE': { actions: 'showMore' },
    'FILTER.TOGGLE_CATEGORY': { actions: 'toggleCategoryFilter' },
    'FILTER.CLEAR': { actions: 'clearCategoryFilters' },
    // Import events
    'PROMPTS.IMPORT': {
      actions: ['setImportingPrompts', 'sendImportPrompts'],
    },
    'PROMPTS.RESET_IMPORT_STATUS': {
      actions: 'resetImportPromptsStatus',
    },
    PROMPTS_IMPORTED: {
      actions: 'handlePromptsImported',
    },
    PROMPTS_IMPORT_FAILED: {
      actions: 'handlePromptsImportFailed',
    },
    // Export events
    'PROMPTS.EXPORT': {
      actions: ['setExportingPrompts', 'sendExportPrompts'],
    },
    'PROMPTS.RESET_EXPORT_STATUS': {
      actions: 'resetExportPromptsStatus',
    },
    PROMPTS_EXPORTED: {
      actions: 'handlePromptsExported',
    },
    PROMPTS_EXPORT_FAILED: {
      actions: 'handlePromptsExportFailed',
    },
    'PROMPT.UPDATE_INPUTS': { actions: 'updatePromptInputs' },
    'PROMPT.CREATE_INLINE': { actions: 'createPromptInline' },
    'PROMPT.UPDATE_LABEL': { actions: 'updatePromptLabel' },
    ...TRAIL_CLICK([
      ['.list', 'list'],
      ['.create', 'create'],
      ['.detail', 'detail'],
    ]),
  },
  states: {
    list: {
      entry: 'clearSelectedPrompt',
      tags: ['list-prompts'],
      meta: { ...breadcrumb('list', 'Prompts', true) },
      on: {
        'PROMPT.CREATE': {
          actions: 'initCreateForm',
          target: 'create',
        },
        'PROMPT.DELETE': {
          actions: 'sendDeletePrompt',
        },
      }
    },
    create: {
      tags: ['create-prompt'],
      meta: { ...breadcrumb('create', 'New Prompt') },
      on: {
        'FORM.UPDATE_LABEL': { actions: 'updateFormLabel' },
        'FORM.UPDATE_DESCRIPTION': { actions: 'updateFormDescription' },
        'FORM.UPDATE_INPUTS': { actions: 'updateFormInputs' },
        'FORM.UPDATE_TEMPLATE': { actions: 'updateFormTemplate' },
        'FORM.UPDATE_OUTPUT_SCHEMA': { actions: 'updateFormOutputSchema' },
        'FORM.UPDATE_CATEGORY': { actions: 'updateFormCategory' },
        'PROMPT.SAVE': {
          actions: 'sendSavePrompt',
          target: 'list',
        },
      },
    },
    detail: {
      tags: ['detail-prompt'],
      meta: {
        ...breadcrumbWithParams<PromptsContext>({
          target: 'detail',
          getLabel: (ctx) => {
            return ctx.selectedLabel || ctx.selectedPromptId || '';
          }
        }),
        ...contextMenuFn<PromptsContext>((ctx) => [
          { label: 'Delete Prompt', icon: Trash2, event: { type: 'PROMPT.DELETE' as const, promptId: ctx.selectedPromptId! }, iconColor: 'text-red-400', confirm: `Are you sure you want to delete "${ctx.selectedLabel || 'this prompt'}"?` },
        ]),
      },
      on: {
        // The open prompt deleted, here or in another window: there is nothing left to show
        'PROMPT.LOADED': [
          { guard: and(['loadsSelected', 'loadsNothing']), target: 'list' },
          { guard: 'loadsSelected', actions: 'showLoadedPrompt' },
        ],
        'FORM.UPDATE_LABEL': { actions: 'updateFormLabel' },
        'FORM.UPDATE_DESCRIPTION': { actions: 'updateFormDescription' },
        'FORM.UPDATE_INPUTS': { actions: 'updateFormInputs' },
        'FORM.UPDATE_TEMPLATE': { actions: 'updateFormTemplate' },
        'FORM.UPDATE_OUTPUT_SCHEMA': { actions: 'updateFormOutputSchema' },
        'FORM.UPDATE_CATEGORY': { actions: 'updateFormCategory' },
        'PROMPT.SAVE': {
          actions: 'sendSavePrompt',
          target: 'list',
        },
        'PROMPT.DELETE': {
          actions: 'sendDeletePrompt',
        },
      },
    },
  },
})

export default promptsState
