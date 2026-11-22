import { entityIs, freshKey, makes, type MadeEvent, type Making } from '@apackdev/sdk/fe'
import type { OpenEntity } from '@apackdev/sdk/events'
import { and, assign, enqueueActions, setup, type ActorRefFrom } from 'xstate'
import breadcrumb, { breadcrumbWithParams } from '@apackdev/sdk/fe'
import { safeEvents } from '@apackdev/sdk/fe'
import {
  targetIs,
  TRAIL_CLICK,
  type TrailClickEvent,
} from '@apackdev/sdk/fe'
import type { Contract, PromptsContext, PromptsInboxEvent } from './contract.ts'
import type { PromptEntity, TemplateInput } from '@apackdev/sdk'
import type { EARS } from '#generated/ears.ts'
import { fromAsk } from '#generated/events.ts'
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
  | { type: 'PROMPTS.FORGET_EXPORT' }

/**
 * The asks this window makes. Each write is asked on its own, so one refused says so whatever else is under way; an
 * import and an export are one at a time
 */
const made = makes(({ one, each }) => ({
  createPrompt: each(fromAsk('prompts', 'CREATE_PROMPT')),
  updatePrompt: each(fromAsk('prompts', 'UPDATE_PROMPT')),
  deletePrompt: each(fromAsk('prompts', 'DELETE_PROMPT')),
  importPrompts: one(fromAsk('prompts', 'IMPORT_PROMPTS')),
  exportPrompts: one(fromAsk('prompts', 'EXPORT_PROMPTS')),
}))

/** How an ask the machine made ended */
type Made = MadeEvent<typeof made>

/** What the machine holds: what the surface publishes, the asks under way, and how the last import and export ended */
type PromptsMachineContext = PromptsContext & {
  /** Which of the asks the machine makes (`made`) are under way */
  making: Making<typeof made>
  /** How the last import ended, until another file is picked */
  imported?: Extract<Made, { type: 'made.importPrompts' }>['outcome']
  /** How the last export ended, until another is made */
  exported?: Extract<Made, { type: 'made.exportPrompts' }>['outcome']
}

export type PromptsEvents = OpenEntity | UIEvent | TrailClickEvent | Made

const typeOf = safeEvents<PromptsEvents>()

const promptsState = setup({
  types: {
    context: {} as PromptsMachineContext,
    events: {} as PromptsEvents,
  },
  actors: made.actors,
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

    sendSavePrompt: enqueueActions(({ context, enqueue }) => {
      // Creating or updating, by whether one is open
      if (!context.selectedPromptId) made.make(enqueue, 'createPrompt', freshKey(), context.formData)
      else made.make(enqueue, 'updatePrompt', freshKey(), { promptId: context.selectedPromptId, ...context.formData })
    }),

    sendDeletePrompt: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('PROMPT.DELETE', event);
      made.make(enqueue, 'deletePrompt', freshKey(), { promptId: ev.promptId })
    }),

    updatePromptInputs: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('PROMPT.UPDATE_INPUTS', event);
      made.make(enqueue, 'updatePrompt', freshKey(), { promptId: ev.promptId, inputs: ev.inputs })
    }),

    createPromptInline: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('PROMPT.CREATE_INLINE', event);
      made.make(enqueue, 'createPrompt', freshKey(), { label: ev.label, templateFn: ev.templateFn, inputs: ev.inputs })
    }),

    updatePromptLabel: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('PROMPT.UPDATE_LABEL', event);
      made.make(enqueue, 'updatePrompt', freshKey(), { promptId: ev.promptId, label: ev.label })
    }),

    /** A write this window asked for and did not get, shown until dismissed */
    showRefusal: assign(({ event }) => {
      const { outcome } = typeOf(['made.createPrompt', 'made.updatePrompt', 'made.deletePrompt'], event)
      return outcome.ok ? {} : { writeError: outcome.failure.message }
    }),

    /* ── import and export ───────────────────────────────── */
    importPrompts: enqueueActions(({ event, enqueue }) => {
      enqueue.assign({ imported: undefined })
      made.make(enqueue, 'importPrompts', { prompts: typeOf('PROMPTS.IMPORT', event).prompts })
    }),

    exportPrompts: enqueueActions(({ event, enqueue }) => {
      enqueue.assign({ exported: undefined })
      made.make(enqueue, 'exportPrompts', { directory: typeOf('PROMPTS.EXPORT', event).directory })
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
    loadsSelected: ({ context, event }) => typeOf('PROMPT.LOADED', event).promptId === context.selectedPromptId,
    /** Whether the open prompt is gone */
    loadsNothing: ({ event }) => typeOf('PROMPT.LOADED', event).prompt === null,
  },
}).createMachine({
  id,
  initial: 'list',
  context: {
    selectedPromptId: undefined,
    selectedLabel: undefined,
    formFor: undefined,
    listLimit: PROMPTS_PAGE_SIZE,
    writeError: null,
    making: made.none(),
    selectedCategories: [], // Filter state
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
    // What a write changed reaches every window through the views, so a landed one needs nothing here
    [made.done]: { actions: made.settle() },
    'made.createPrompt': { actions: 'showRefusal' },
    'made.updatePrompt': { actions: 'showRefusal' },
    'made.deletePrompt': { actions: 'showRefusal' },
    'PROMPTS.IMPORT': { actions: 'importPrompts' },
    'PROMPTS.FORGET_IMPORT': { actions: assign({ imported: undefined }) },
    'made.importPrompts': { actions: assign(({ event }) => ({ imported: event.outcome })) },
    'PROMPTS.EXPORT': { actions: 'exportPrompts' },
    'PROMPTS.FORGET_EXPORT': { actions: assign({ exported: undefined }) },
    'made.exportPrompts': { actions: assign(({ event }) => ({ exported: event.outcome })) },
    CLEAR_WRITE_ERROR: { actions: assign({ writeError: null }) },
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
