import { askId, endedAsk, entityIs } from '@apackdev/sdk/fe'
import type { OpenEntity } from '@apackdev/sdk/events'
import { and, assign, enqueueActions, setup, stopChild, type ActorRefFrom } from 'xstate'
import breadcrumb, { breadcrumbWithParams } from '@apackdev/sdk/fe'
import { safeEvents } from '@apackdev/sdk/fe'
import {
  targetIs,
  TRAIL_CLICK,
  type TrailClickEvent,
} from '@apackdev/sdk/fe'
import type { Contract, ActionsContext, ActionsInboxEvent } from './contract.ts'
import type { UntypedAskOutcome } from '@apackdev/sdk/events'
import { outcomeOf } from '@apackdev/sdk/helpers'
import type { ActionEntity, ActionParameter } from '@apackdev/sdk'
import type { EARS } from '#generated/ears.ts'
import { fromAsk } from '#generated/events.ts'
import { Trash2 } from 'lucide-vue-next'
import { contextMenuFn } from '@apackdev/sdk/fe'

/* ─────────────────────────────────────────────────────────── */
/* Machine Types                                               */
/* ─────────────────────────────────────────────────────────── */
export const id = 'actions' as const;
export type ActionsState = ActorRefFrom<typeof actionsState>

/** How many more actions the list shows each time the user reaches its end */
export const ACTIONS_PAGE_SIZE = 20

type UIEvent =
  | { type: 'CLEAR_WRITE_ERROR' }
  | ActionsInboxEvent
  | { type: 'ACTION.SAVE' }
  /**
   * What the open action's view read, which the canvas hands on: the action, or `null` once it's gone (deleted here
   * or in another window). About the UI, not the data — it fills the form once and keeps the breadcrumb's label.
   */
  | { type: 'ACTION.LOADED'; actionId: EARS.EntityId; action: ActionEntity | null }
  | { type: 'ACTIONS.LOAD_MORE' }
  | { type: 'FORM.UPDATE_CATEGORY'; category: string }
  | { type: 'FORM.UPDATE_LABEL'; label: string }
  | { type: 'FORM.UPDATE_DESCRIPTION'; description: string }
  | { type: 'FORM.UPDATE_PARAMETERS'; input: Record<string, ActionParameter> }
  | { type: 'FORM.UPDATE_ACTION'; actionFn: string }
  | { type: 'FORM.UPDATE_OUTPUT'; output: any }
  | { type: 'VIEW_LIST' }
  | { type: 'TOGGLE_PARAMETERS_SECTION'; show: boolean }
  | { type: 'TOGGLE_OUTPUT_SECTION'; show: boolean }
  | { type: 'TOGGLE_METADATA_SECTION'; show: boolean }
  | { type: 'FILTER.TOGGLE_CATEGORY'; categoryName: string }
  | { type: 'FILTER.CLEAR' }

/** One of this window's writes ended: the done event of the ask spawned for it, which says whether it was refused */
type WriteEnded = { type: `xstate.done.actor.write.${number}`; output: UntypedAskOutcome; actorId: string }

export type ActionsEvents = OpenEntity | UIEvent | TrailClickEvent | WriteEnded

const typeOf = safeEvents<ActionsEvents>()

const actionsState = setup({
  types: {
    context: {} as ActionsContext,
    events: {} as ActionsEvents,
  },
  actors: {
    // This window's writes. Each is asked on its own, so one refused says so whatever else is under way
    createAction: fromAsk('actions', 'CREATE_ACTION'),
    updateAction: fromAsk('actions', 'UPDATE_ACTION'),
    deleteAction: fromAsk('actions', 'DELETE_ACTION'),
  },
  actions: {
    // The list shows no action, so reopening one fills its form afresh from what its view reads then
    clearSelectedAction: assign({ selectedActionId: undefined, selectedLabel: undefined, formFor: undefined }),

    /* ── action interactions ────────────────────────────── */
    selectAction: assign(({ event, context }) => {
      const actionId = event.type === 'OPEN_ENTITY' ? event.id as EARS.EntityId : typeOf('ACTION.SELECT', event).actionId;
      if (context.selectedActionId === actionId) return {};
      return { selectedActionId: actionId, selectedLabel: undefined, formFor: undefined };
    }),

    showLoadedAction: assign(({ event, context }) => {
      const { actionId, action } = typeOf('ACTION.LOADED', event);
      if (!action) return {};
      // The form is filled once per opening: a change the view brings later (another window's edit) leaves what the
      // user is typing alone, and saving writes the form as it stands
      if (context.formFor === actionId) return { selectedLabel: action.label };
      return {
        selectedLabel: action.label,
        formFor: actionId,
        formData: {
          label: action.label,
          description: action.description,
          category: action.category,
          input: action.input,
          actionFn: action.actionFn,
          output: action.output,
        },
      };
    }),

    initCreateForm: assign({
      formData: {
        label: '',
        description: '',
        category: '',
        input: {},
        actionFn: '// Your action function body here\n// Available services: logger, database, email, http\nreturn { success: true };',
        output: undefined,
      },
      selectedActionId: undefined,
      selectedLabel: undefined,
      formFor: undefined,
    }),

    sendSaveAction: enqueueActions(({ context, enqueue }) => {
      // Creating or updating, by whether one is open
      if (!context.selectedActionId) enqueue.spawnChild('createAction', { id: askId('write'), input: context.formData })
      else enqueue.spawnChild('updateAction', { id: askId('write'), input: { actionId: context.selectedActionId, ...context.formData } })
    }),

    sendDeleteAction: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('ACTION.DELETE', event);
      enqueue.spawnChild('deleteAction', { id: askId('write'), input: { actionId: ev.actionId } })
    }),

    updateActionInput: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('ACTION.UPDATE_INPUT', event);
      enqueue.spawnChild('updateAction', { id: askId('write'), input: { actionId: ev.actionId, input: ev.input } })
    }),

    createActionInline: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('ACTION.CREATE_INLINE', event);
      enqueue.spawnChild('createAction', { id: askId('write'), input: { label: ev.label, actionFn: ev.actionFn, input: ev.input } })
    }),

    updateActionLabel: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('ACTION.UPDATE_LABEL', event);
      enqueue.spawnChild('updateAction', { id: askId('write'), input: { actionId: ev.actionId, label: ev.label } })
    }),

    /** A write this window asked for and did not get, shown until dismissed */
    showRefusal: assign(({ event }) => {
      const output = outcomeOf<UntypedAskOutcome>(event)
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

    updateFormParameters: assign(({ event, context }) => {
      const ev = typeOf('FORM.UPDATE_PARAMETERS', event);
      return {
        formData: {
          ...context.formData,
          input: ev.input,
        },
      };
    }),

    updateFormAction: assign(({ event, context }) => {
      const ev = typeOf('FORM.UPDATE_ACTION', event);
      return {
        formData: {
          ...context.formData,
          actionFn: ev.actionFn,
        },
      };
    }),

    updateFormOutput: assign(({ event, context }) => {
      const ev = typeOf('FORM.UPDATE_OUTPUT', event);
      return {
        formData: {
          ...context.formData,
          output: ev.output,
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

    toggleParametersSection: assign(({ event, context }) => {
      const ev = typeOf('TOGGLE_PARAMETERS_SECTION', event);
      return {
        formData: {
          ...context.formData,
          parametersExpanded: ev.show,
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
    showMore: assign(({ context }) => ({ listLimit: context.listLimit + ACTIONS_PAGE_SIZE })),

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
    /** Whether what was loaded is the action open now, rather than one the user has since moved on from */
    loadsSelected: ({ context, event }) => typeOf('ACTION.LOADED', event).actionId === context.selectedActionId,
    /** Whether the open action is gone */
    loadsNothing: ({ event }) => typeOf('ACTION.LOADED', event).action === null,
  },
}).createMachine({
  id,
  initial: 'list',
  context: {
    selectedActionId: undefined,
    selectedLabel: undefined,
    formFor: undefined,
    listLimit: ACTIONS_PAGE_SIZE,
    writeError: null,
    selectedCategories: [], // Filter state
    formData: {
      label: '',
      description: '',
      category: '',
      input: {},
      actionFn: '',
      output: undefined,
    },
  },
  on: {
    // What a write changed reaches every window through the views, so a landed one needs nothing here
    'xstate.done.actor.write.*': { actions: ['showRefusal', stopChild(({ event }) => endedAsk(event))] },
    CLEAR_WRITE_ERROR: { actions: assign({ writeError: null }) },
    OPEN_ENTITY: { guard: { type: 'entityIs', params: { entity: 'Action' } }, target: '.detail', actions: 'selectAction' },
    'ACTION.SELECT': { target: '.detail', actions: 'selectAction' },
    'VIEW_LIST': {
      target: '.list',
    },
    TOGGLE_PARAMETERS_SECTION: { actions: 'toggleParametersSection' },
    TOGGLE_OUTPUT_SECTION: { actions: 'toggleOutputSection' },
    TOGGLE_METADATA_SECTION: { actions: 'toggleMetadataSection' },
    'ACTIONS.LOAD_MORE': { actions: 'showMore' },
    'FILTER.TOGGLE_CATEGORY': { actions: 'toggleCategoryFilter' },
    'FILTER.CLEAR': { actions: 'clearCategoryFilters' },
    'ACTION.UPDATE_INPUT': { actions: 'updateActionInput' },
    'ACTION.CREATE_INLINE': { actions: 'createActionInline' },
    'ACTION.UPDATE_LABEL': { actions: 'updateActionLabel' },
    ...TRAIL_CLICK([
      ['.list', 'list'],
      ['.create', 'create'],
      ['.detail', 'detail'],
    ]),
  },
  states: {
    list: {
      entry: 'clearSelectedAction',
      tags: ['list-actions'],
      meta: { ...breadcrumb('list', 'Actions', true) },
      on: {
        'ACTION.CREATE': {
          actions: 'initCreateForm',
          target: 'create',
        },
        'ACTION.DELETE': {
          actions: 'sendDeleteAction',
        },
      }
    },
    create: {
      tags: ['create-action'],
      meta: { ...breadcrumb('create', 'New Action') },
      on: {
        'FORM.UPDATE_LABEL': { actions: 'updateFormLabel' },
        'FORM.UPDATE_DESCRIPTION': { actions: 'updateFormDescription' },
        'FORM.UPDATE_PARAMETERS': { actions: 'updateFormParameters' },
        'FORM.UPDATE_ACTION': { actions: 'updateFormAction' },
        'FORM.UPDATE_OUTPUT': { actions: 'updateFormOutput' },
        'FORM.UPDATE_CATEGORY': { actions: 'updateFormCategory' },
        'ACTION.SAVE': {
          actions: 'sendSaveAction',
          target: 'list',
        },
      },
    },
    detail: {
      tags: ['detail-action'],
      meta: {
        ...breadcrumbWithParams<ActionsContext>({
          target: 'detail',
          getLabel: (ctx) => {
            return ctx.selectedLabel || ctx.selectedActionId || '';
          }
        }),
        ...contextMenuFn<ActionsContext>((ctx) => [
          { label: 'Delete Action', icon: Trash2, event: { type: 'ACTION.DELETE' as const, actionId: ctx.selectedActionId! }, iconColor: 'text-red-400', confirm: `Are you sure you want to delete "${ctx.selectedLabel || 'this action'}"?` },
        ]),
      },
      on: {
        // The open action deleted, here or in another window: there is nothing left to show
        'ACTION.LOADED': [
          { guard: and(['loadsSelected', 'loadsNothing']), target: 'list' },
          { guard: 'loadsSelected', actions: 'showLoadedAction' },
        ],
        'FORM.UPDATE_LABEL': { actions: 'updateFormLabel' },
        'FORM.UPDATE_DESCRIPTION': { actions: 'updateFormDescription' },
        'FORM.UPDATE_PARAMETERS': { actions: 'updateFormParameters' },
        'FORM.UPDATE_ACTION': { actions: 'updateFormAction' },
        'FORM.UPDATE_OUTPUT': { actions: 'updateFormOutput' },
        'FORM.UPDATE_CATEGORY': { actions: 'updateFormCategory' },
        'ACTION.SAVE': {
          actions: 'sendSaveAction',
          target: 'list',
        },
        'ACTION.DELETE': {
          actions: 'sendDeleteAction',
        },
      },
    },
  },
})

export default actionsState
