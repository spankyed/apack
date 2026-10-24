import { entityIs } from '@apackdev/sdk/fe'
import type { OpenEntity } from '@apackdev/sdk/events'
import { assign, enqueueActions, setup, type ActorRefFrom } from 'xstate'
import breadcrumb, { breadcrumbWithParams } from '@apackdev/sdk/fe'
import { safeEvents } from '@apackdev/sdk/fe'
import {
  targetIs,
  TRAIL_CLICK,
  type TrailClickEvent,
} from '@apackdev/sdk/fe'
import type { PromptsSettings } from '#generated/types.ts'
import type { Contract, PromptsContext, PromptsInboxEvent } from './contract.ts'
import type { OutgoingPromptEvents } from '#features/prompts/be/types.ts'
import type { TemplateInput } from '@apackdev/sdk'
import { sendToSystem } from '#generated/events.ts'
import { answersCall, newCall } from '@apackdev/sdk/events'
import { Trash2 } from 'lucide-vue-next'
import { contextMenuFn } from '@apackdev/sdk/fe'
import type { PromptEntity } from '@apackdev/sdk'

/* ─────────────────────────────────────────────────────────── */
/* Machine Types                                               */
/* ─────────────────────────────────────────────────────────── */
export const id = 'prompts' as const;
export type PromptsState = ActorRefFrom<typeof promptsState>


type SystemEvent = OutgoingPromptEvents
  | { type: 'PROMPTS_PAGE_LOADED'; data: { prompts: PromptEntity[]; page: number; totalPages: number } }
  | { type: 'PROMPTS_ALL_LOADED'; data: { prompts: PromptEntity[] } }
  | { type: 'PROMPTS_IMPORTED'; count: number; errors?: string[] }
  | { type: 'PROMPTS_IMPORT_FAILED'; errors: string[] }
  | { type: 'PROMPTS_EXPORTED'; filePath: string; promptCount: number }
  | { type: 'PROMPTS_EXPORT_FAILED'; errors: string[] }

type UIEvent =
  | PromptsInboxEvent
  | { type: 'PROMPT.CREATE' }
  | { type: 'PROMPT.SAVE' }
  | { type: 'FORM.UPDATE_CATEGORY'; category: string }
  | { type: 'FORM.UPDATE_LABEL'; label: string }
  | { type: 'FORM.UPDATE_DESCRIPTION'; description: string }
  | { type: 'FORM.UPDATE_INPUTS'; inputs: Record<string, TemplateInput> }
  | { type: 'FORM.UPDATE_TEMPLATE'; templateFn: string }
  | { type: 'FORM.UPDATE_OUTPUT_SCHEMA'; outputSchema: any }
  | { type: 'VIEW_LIST' }
  | { type: 'SURFACE_DEACTIVATED' }
  | { type: 'TOGGLE_INPUTS_SECTION'; show: boolean }
  | { type: 'TOGGLE_OUTPUT_SECTION'; show: boolean }
  | { type: 'TOGGLE_METADATA_SECTION'; show: boolean }
  | { type: 'FEATURE_SETTINGS_UPDATED'; settings: PromptsSettings }
  | { type: 'FILTER.TOGGLE_CATEGORY'; categoryName: string }
  | { type: 'FILTER.CLEAR' }
  // Import/Export events
  | { type: 'PROMPTS.IMPORT'; prompts: any[] }
  | { type: 'PROMPTS.RESET_IMPORT_STATUS' }
  | { type: 'PROMPTS.EXPORT'; directory: string }
  | { type: 'PROMPTS.RESET_EXPORT_STATUS' }

export type PromptsEvents = OpenEntity | UIEvent | SystemEvent | TrailClickEvent
const typeOf = safeEvents<PromptsEvents>()

const promptsState = setup({
  types: {
    context: {} as PromptsContext,
    events: {} as PromptsEvents,
  },
  actions: {
    /* ── bootstrap ─────────────────────────────────────── */
    setSurfaceData: assign(({ event }) => {
      const ev = typeOf('PROMPTS_CONNECTED', event);
      return {
        prompts: ev.data.prompts,
        totalCount: ev.data.totalCount,
        page: ev.data.page,
        totalPages: ev.data.totalPages,
        categories: ev.data.categories || [],
      }
    }),

    cancelSelection: assign({ pendingPromptCall: null }),
    // The list shows no prompt, so reopening one asks for it again rather than showing a form that may be stale
    clearSelectedPrompt: assign({ selectedPromptId: undefined, selectedPrompt: undefined }),

    /* ── prompt interactions ────────────────────────────── */
    /**
     * **`enqueueActions`, so the call is stored before the ask is sent.** A send made from inside an
     * `assign` producer runs before the assign is applied, so an answer that arrives synchronously is
     * matched against a slot the ask has not written yet. Against a backend in another process the race
     * never shows; against one that answers in the same turn it always does.
     */
    selectPrompt: enqueueActions(({ event, context, enqueue }) => {
      const promptId = event.type === 'OPEN_ENTITY' ? event.id : typeOf('PROMPT.SELECT', event).promptId;
      if (context.selectedPromptId === promptId) return;
      const call = newCall();
      // Recorded before the ask, so the answer can be told from one for a selection since replaced
      enqueue.assign({ pendingPromptCall: call });
      enqueue(() => sendToSystem(id, { type: 'PROMPT_SELECT', promptId }, { call }));
    }),

    loadPromptData: assign(({ event }) => {
      const ev = typeOf('PROMPT_SELECTED', event);
      return {
        // Settled: nothing is outstanding, so a later answer for an abandoned ask has no call to match
        pendingPromptCall: null,
        selectedPromptId: ev.promptId,
        selectedPrompt: ev.data,
        formData: {
          label: ev.data.label,
          description: ev.data.description,
          category: ev.data.category,
          inputs: ev.data.inputs,
          templateFn: ev.data.templateFn,
          outputSchema: ev.data.outputSchema,
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
      selectedPrompt: undefined,
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

    // News every window hears, whoever wrote it — this window, another, or any other writer of the data: each names
    // its prompt, and changes the selection only when it is that prompt. A created prompt selects nothing, so opening
    // it fetches it, and one the list holds already is replaced rather than listed twice
    addCreatedPrompt: assign(({ context, event }) => {
      const { prompt } = typeOf('PROMPT_CREATED', event);
      const held = context.prompts.some(p => p.id === prompt.id);
      return { prompts: held ? context.prompts.map(p => (p.id === prompt.id ? prompt : p)) : [...context.prompts, prompt] };
    }),

    updatePromptInList: assign(({ context, event }) => {
      const ev = typeOf('PROMPT_UPDATED', event);
      return {
        prompts: context.prompts.map(p => 
          p.id === ev.promptId ? ev.prompt : p
        ),
        ...(context.selectedPromptId === ev.promptId && { selectedPrompt: ev.prompt }),
      };
    }),

    removeDeletedPrompt: assign(({ context, event }) => {
      const ev = typeOf('PROMPT_DELETED', event);
      return {
        prompts: context.prompts.filter(p => p.id !== ev.promptId),
        ...(context.selectedPromptId === ev.promptId && { selectedPromptId: undefined, selectedPrompt: undefined }),
      };
    }),

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
    
    handleSettingsUpdate: assign(({ event }) => {
      const ev = typeOf('FEATURE_SETTINGS_UPDATED', event);
      return {
        categories: ev.settings?.categories || [],
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

    /* ── pagination ────────────────────────────────────────── */
    requestNextPage: assign(({ context }) => {
      sendToSystem(id, {
        type: 'FETCH_PROMPTS_PAGE',
        page: context.page + 1,
      });
      return { loadingMore: true };
    }),

    appendPageData: assign(({ context, event }) => {
      const ev = typeOf('PROMPTS_PAGE_LOADED', event);
      return {
        prompts: [...context.prompts, ...ev.data.prompts],
        page: ev.data.page,
        totalPages: ev.data.totalPages,
        loadingMore: false,
      };
    }),

    requestAllItems: assign(() => {
      sendToSystem(id, {
        type: 'FETCH_ALL_PROMPTS',
      });
      return { loadingMore: true };
    }),

    setAllItems: assign(({ event }) => {
      const ev = typeOf('PROMPTS_ALL_LOADED', event);
      return {
        prompts: ev.data.prompts,
        page: 1,
        totalPages: 1,
        loadingMore: false,
      };
    }),

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
    /** Whether this answer is the one the outstanding ask is waiting for, and false when none is */
    answersPendingPrompt: ({ context, event }) => answersCall(event, context.pendingPromptCall),
    /** Whether this page is the one just asked for — two clicks ask for the same one */
    isNextPage: ({ context, event }) =>
      (event as { data?: { page?: number } }).data?.page === context.page + 1,
    /** Whether the deleted prompt is the one open */
    deletesSelected: ({ context, event }) => (event as { promptId?: string }).promptId === context.selectedPromptId,
  },
}).createMachine({
  id,
  initial: 'list',
  context: {
    selectedPromptId: undefined,
    pendingPromptCall: null,
    prompts: [],
    selectedPrompt: undefined,
    totalCount: 0,
    page: 1,
    totalPages: 1,
    loadingMore: false,
    categories: [], // Will be populated from settings
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
    SURFACE_DEACTIVATED: { actions: 'cancelSelection' },
    OPEN_ENTITY: { guard: { type: 'entityIs', params: { entity: 'Prompt' } }, target: '.detail', actions: 'selectPrompt' },
    'PROMPT.SELECT': { target: '.detail', actions: 'selectPrompt' },
    'VIEW_LIST': {
      target: '.list',
    },
    PROMPTS_CONNECTED: { actions: 'setSurfaceData' },
    PROMPT_SELECTED: { guard: 'answersPendingPrompt', actions: 'loadPromptData' },
    FEATURE_SETTINGS_UPDATED: { actions: 'handleSettingsUpdate' },
    PROMPT_CREATED: {
      actions: 'addCreatedPrompt'
    },
    PROMPT_UPDATED: {
      actions: 'updatePromptInList'
    },
    PROMPT_DELETED: [
      { guard: 'deletesSelected', actions: 'removeDeletedPrompt', target: '.list' },
      { actions: 'removeDeletedPrompt' },
    ],
    TOGGLE_INPUTS_SECTION: { actions: 'toggleInputsSection' },
    TOGGLE_OUTPUT_SECTION: { actions: 'toggleOutputSection' },
    TOGGLE_METADATA_SECTION: { actions: 'toggleMetadataSection' },
    'PROMPTS.LOAD_MORE': { actions: 'requestNextPage' },
    'PROMPTS.LOAD_ALL': { actions: 'requestAllItems' },
    PROMPTS_PAGE_LOADED: { guard: 'isNextPage', actions: 'appendPageData' },
    PROMPTS_ALL_LOADED: { actions: 'setAllItems' },
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
      exit: 'cancelSelection',
      tags: ['detail-prompt'],
      meta: {
        ...breadcrumbWithParams<PromptsContext>({
          target: 'detail',
          getLabel: (ctx) => {
            return ctx.selectedPrompt?.label || ctx.selectedPromptId || '';
          }
        }),
        ...contextMenuFn<PromptsContext>((ctx) => [
          { label: 'Delete Prompt', icon: Trash2, event: { type: 'PROMPT.DELETE' as const, promptId: ctx.selectedPromptId! }, iconColor: 'text-red-400', confirm: `Are you sure you want to delete "${ctx.selectedPrompt?.label || 'this prompt'}"?` },
        ]),
      },
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
        'PROMPT.DELETE': {
          actions: 'sendDeletePrompt',
        },
      },
    },
  },
})

export default promptsState 