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
import type { Contract, ActionsContext, ActionsInboxEvent } from './contract.ts'
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
  /** The settings form's import and export, and the result of each no longer shown */
  | { type: 'ACTIONS.IMPORT'; actions: unknown }
  | { type: 'ACTIONS.FORGET_IMPORT' }
  | { type: 'ACTIONS.EXPORT'; directory: string }
  | { type: 'ACTIONS.FORGET_EXPORT' }

/**
 * The asks this window makes. Each write is asked on its own, so one refused says so whatever else is under way; an
 * import and an export are one at a time
 */
const made = makes(({ one, each }) => ({
  createAction: each(fromAsk('actions', 'CREATE_ACTION')),
  updateAction: each(fromAsk('actions', 'UPDATE_ACTION')),
  deleteAction: each(fromAsk('actions', 'DELETE_ACTION')),
  importActions: one(fromAsk('actions', 'IMPORT_ACTIONS')),
  exportActions: one(fromAsk('actions', 'EXPORT_ACTIONS')),
}))

/** How an ask the machine made ended */
type Made = MadeEvent<typeof made>

/** What the machine holds: what the surface publishes, the asks under way, and how the last import and export ended */
type ActionsMachineContext = ActionsContext & {
  /** Which of the asks the machine makes (`made`) are under way */
  making: Making<typeof made>
  /** How the last import ended, until another file is picked */
  imported?: Extract<Made, { type: 'made.importActions' }>['outcome']
  /** How the last export ended, until another is made */
  exported?: Extract<Made, { type: 'made.exportActions' }>['outcome']
}

export type ActionsEvents = OpenEntity | UIEvent | TrailClickEvent | Made

const typeOf = safeEvents<ActionsEvents>()

const actionsState = setup({
  types: {
    context: {} as ActionsMachineContext,
    events: {} as ActionsEvents,
  },
  actors: made.actors,
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
      if (!context.selectedActionId) made.make(enqueue, 'createAction', freshKey(), context.formData)
      else made.make(enqueue, 'updateAction', freshKey(), { actionId: context.selectedActionId, ...context.formData })
    }),

    sendDeleteAction: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('ACTION.DELETE', event);
      made.make(enqueue, 'deleteAction', freshKey(), { actionId: ev.actionId })
    }),

    updateActionInput: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('ACTION.UPDATE_INPUT', event);
      made.make(enqueue, 'updateAction', freshKey(), { actionId: ev.actionId, input: ev.input })
    }),

    createActionInline: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('ACTION.CREATE_INLINE', event);
      made.make(enqueue, 'createAction', freshKey(), { label: ev.label, actionFn: ev.actionFn, input: ev.input })
    }),

    updateActionLabel: enqueueActions(({ event, enqueue }) => {
      const ev = typeOf('ACTION.UPDATE_LABEL', event);
      made.make(enqueue, 'updateAction', freshKey(), { actionId: ev.actionId, label: ev.label })
    }),

    /** A write this window asked for and did not get, shown until dismissed */
    showRefusal: assign(({ event }) => {
      const { outcome } = typeOf(['made.createAction', 'made.updateAction', 'made.deleteAction'], event)
      return outcome.ok ? {} : { writeError: outcome.failure.message }
    }),

    /* ── import and export ───────────────────────────────── */
    importActions: enqueueActions(({ event, enqueue }) => {
      enqueue.assign({ imported: undefined })
      made.make(enqueue, 'importActions', { actions: typeOf('ACTIONS.IMPORT', event).actions })
    }),

    exportActions: enqueueActions(({ event, enqueue }) => {
      enqueue.assign({ exported: undefined })
      made.make(enqueue, 'exportActions', { directory: typeOf('ACTIONS.EXPORT', event).directory })
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
    making: made.none(),
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
    [made.done]: { actions: made.settle() },
    'made.createAction': { actions: 'showRefusal' },
    'made.updateAction': { actions: 'showRefusal' },
    'made.deleteAction': { actions: 'showRefusal' },
    'ACTIONS.IMPORT': { actions: 'importActions' },
    'ACTIONS.FORGET_IMPORT': { actions: assign({ imported: undefined }) },
    'made.importActions': { actions: assign(({ event }) => ({ imported: event.outcome })) },
    'ACTIONS.EXPORT': { actions: 'exportActions' },
    'ACTIONS.FORGET_EXPORT': { actions: assign({ exported: undefined }) },
    'made.exportActions': { actions: assign(({ event }) => ({ exported: event.outcome })) },
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
