import { entityIs } from '@apackdev/sdk/fe'
import type { OpenEntity } from '@apackdev/sdk/events'
import { and, assign, enqueueActions, setup, stopChild, type ActorRefFrom } from 'xstate'
import breadcrumb, { breadcrumbWithParams } from '@apackdev/sdk/fe'
import { safeEvents } from '@apackdev/sdk/fe'
import {
  targetIs,
  TRAIL_CLICK,
  type TrailClickEvent,
} from '@apackdev/sdk/fe'
import type { Contract, PromptsContext, PromptsInboxEvent } from './contract.ts'
import type { UntypedAskOutcome } from '@apackdev/sdk/events'
import { randomId } from '@apackdev/sdk/utils/pure'
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

/** One of this window's writes ended: the done event of the ask spawned for it, which says whether it was refused */
type WriteEnded = { type: `xstate.done.actor.write.${string}`; output: UntypedAskOutcome; actorId: string }

export type PromptsEvents = OpenEntity | UIEvent | TrailClickEvent | WriteEnded

/** A name for the ask one write spawns, which its done event carries back */
const writeId = (): string => `write.${randomId()}`

/** Every write's done event, as a transition names them */
const WRITE_ENDED = 'xstate.done.actor.write.*'

/** The done event of a write, for an action wired to `WRITE_ENDED` */
function writeEnded(event: PromptsEvents): WriteEnded {
  if (!('actorId' in event)) throw new Error(`Expected the done event of a write, got ${event.type}`)
  return event
}

const typeOf = safeEvents<PromptsEvents>()

const promptsState = setup({
  types: {
    context: {} as PromptsContext,
    events: {} as PromptsEvents,
  },
  actors: {
    // This window's writes. Each is asked on its own, so one refused says so whatever else is under way
    createPrompt: fromAsk('prompts', 'CREATE_PROMPT'),
    updatePrompt: fromAsk('prompts', 'UPDATE_PROMPT'),
    deletePrompt: fromAsk('prompts', 'DELETE_PROMPT'),
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

    sendSavePrompt: enqueueActions(({ context, enqueue }) => {
      // Creating or updating, by whether one is open
      if (!context.selectedPromptId) enqueue.spawnChild('createPrompt', { id: writeId(), input: context.formData })
      else enqueue.spawnChild('updatePrompt', { id: writeId(), input: { promptId: context.selectedPromptId, ...context.formData } })
    }),

    sendDeletePrompt: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('PROMPT.DELETE', event);
      enqueue.spawnChild('deletePrompt', { id: writeId(), input: { promptId: ev.promptId } })
    }),

    updatePromptInputs: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('PROMPT.UPDATE_INPUTS', event);
      enqueue.spawnChild('updatePrompt', { id: writeId(), input: { promptId: ev.promptId, inputs: ev.inputs } })
    }),

    createPromptInline: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('PROMPT.CREATE_INLINE', event);
      enqueue.spawnChild('createPrompt', { id: writeId(), input: { label: ev.label, templateFn: ev.templateFn, inputs: ev.inputs } })
    }),

    updatePromptLabel: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('PROMPT.UPDATE_LABEL', event);
      enqueue.spawnChild('updatePrompt', { id: writeId(), input: { promptId: ev.promptId, label: ev.label } })
    }),

    /** A write this window asked for and did not get, shown until dismissed */
    showRefusal: assign(({ event }) => {
      const { output } = writeEnded(event)
      return output.ok ? {} : { writeError: output.failure.message }
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
    [WRITE_ENDED]: { actions: ['showRefusal', stopChild(({ event }) => writeEnded(event).actorId)] },
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
