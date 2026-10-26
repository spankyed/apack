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
import type { Contract, ActionsContext, ActionsInboxEvent } from './contract.ts'
import type { OutgoingActionEvents } from '#features/actions/be/types.ts'
import type { ActionEntity, ActionParameter } from '@apackdev/sdk'
import type { EARS } from '#generated/ears.ts'
import { sendToSystem } from '#generated/events.ts'
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
  // Import/Export events
  | { type: 'ACTIONS.IMPORT'; actions: any[] }
  | { type: 'ACTIONS.RESET_IMPORT_STATUS' }
  | { type: 'ACTIONS.EXPORT'; directory: string }
  | { type: 'ACTIONS.RESET_EXPORT_STATUS' }

export type ActionsEvents = OpenEntity | UIEvent | OutgoingActionEvents | TrailClickEvent
const typeOf = safeEvents<ActionsEvents>()

const actionsState = setup({
  types: {
    context: {} as ActionsContext,
    events: {} as ActionsEvents,
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

    sendSaveAction: ({ context }) => {
      // Determine if creating or updating based on selectedActionId
      const isCreating = !context.selectedActionId;

      if (isCreating) {
        // Create new action
        sendToSystem(id, {
          type: 'CREATE_ACTION',
          ...context.formData,
        })
      } else {
        // Update existing action
        sendToSystem(id, {
          type: 'UPDATE_ACTION',
          actionId: context.selectedActionId!,
          ...context.formData,
        })
      }
    },

    sendDeleteAction: ({ event }) => {
      const ev = typeOf('ACTION.DELETE', event);
      sendToSystem(id, {
        type: 'DELETE_ACTION',
        actionId: ev.actionId,
      });
    },

    updateActionInput: ({ event }) => {
      const ev = typeOf('ACTION.UPDATE_INPUT', event);
      sendToSystem(id, {
        type: 'UPDATE_ACTION',
        actionId: ev.actionId,
        input: ev.input,
      });
    },

    createActionInline: ({ event }) => {
      const ev = typeOf('ACTION.CREATE_INLINE', event);
      sendToSystem(id, {
        type: 'CREATE_ACTION',
        label: ev.label,
        actionFn: ev.actionFn,
        input: ev.input,
      });
    },

    updateActionLabel: ({ event }) => {
      const ev = typeOf('ACTION.UPDATE_LABEL', event);
      sendToSystem(id, {
        type: 'UPDATE_ACTION',
        actionId: ev.actionId,
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

    /* ── Actions Import actions ────────────────────────────── */
    setImportingActions: assign(({ context }) => ({
      actionsImport: {
        ...context.actionsImport,
        status: 'importing' as const,
      },
    })),

    sendImportActions: ({ event }) => {
      const ev = typeOf('ACTIONS.IMPORT', event);
      sendToSystem(id, {
        type: 'IMPORT_ACTIONS',
        actions: ev.actions,
      });
    },

    handleActionsImported: assign(({ event }) => {
      const ev = typeOf('ACTIONS_IMPORTED', event);
      return {
        actionsImport: {
          status: 'success' as const,
          errors: ev.errors || [],
          importedCount: ev.count,
        },
      };
    }),

    handleActionsImportFailed: assign(({ event }) => {
      const ev = typeOf('ACTIONS_IMPORT_FAILED', event);
      return {
        actionsImport: {
          status: 'error' as const,
          errors: ev.errors,
          importedCount: 0,
        },
      };
    }),

    resetImportActionsStatus: assign({
      actionsImport: { status: 'idle' as const, errors: [], importedCount: 0 },
    }),

    /* ── Actions Export actions ────────────────────────────── */
    setExportingActions: assign(({ context }) => ({
      actionsExport: {
        ...context.actionsExport,
        status: 'exporting' as const,
      },
    })),

    sendExportActions: ({ event }) => {
      const ev = typeOf('ACTIONS.EXPORT', event);
      sendToSystem(id, {
        type: 'EXPORT_ACTIONS',
        directory: ev.directory,
      });
    },

    handleActionsExported: assign(({ event }) => {
      const ev = typeOf('ACTIONS_EXPORTED', event);
      return {
        actionsExport: {
          status: 'success' as const,
          errors: [],
          filePath: ev.filePath,
          actionCount: ev.actionCount,
        },
      };
    }),

    handleActionsExportFailed: assign(({ event }) => {
      const ev = typeOf('ACTIONS_EXPORT_FAILED', event);
      return {
        actionsExport: {
          status: 'error' as const,
          errors: ev.errors,
          filePath: '',
          actionCount: 0,
        },
      };
    }),

    resetExportActionsStatus: assign({
      actionsExport: { status: 'idle' as const, errors: [], filePath: '', actionCount: 0 },
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
    loadsSelected: ({ context, event }) => (event as { actionId?: string }).actionId === context.selectedActionId,
    /** Whether the open action is gone */
    loadsNothing: ({ event }) => (event as { action?: unknown }).action === null,
  },
}).createMachine({
  id,
  initial: 'list',
  context: {
    selectedActionId: undefined,
    selectedLabel: undefined,
    formFor: undefined,
    listLimit: ACTIONS_PAGE_SIZE,
    selectedCategories: [], // Filter state
    actionsImport: {
      status: 'idle',
      errors: [],
      importedCount: 0,
    },
    actionsExport: {
      status: 'idle',
      errors: [],
      filePath: '',
      actionCount: 0,
    },
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
    // Import events
    'ACTIONS.IMPORT': {
      actions: ['setImportingActions', 'sendImportActions'],
    },
    'ACTIONS.RESET_IMPORT_STATUS': {
      actions: 'resetImportActionsStatus',
    },
    ACTIONS_IMPORTED: {
      actions: 'handleActionsImported',
    },
    ACTIONS_IMPORT_FAILED: {
      actions: 'handleActionsImportFailed',
    },
    // Export events
    'ACTIONS.EXPORT': {
      actions: ['setExportingActions', 'sendExportActions'],
    },
    'ACTIONS.RESET_EXPORT_STATUS': {
      actions: 'resetExportActionsStatus',
    },
    ACTIONS_EXPORTED: {
      actions: 'handleActionsExported',
    },
    ACTIONS_EXPORT_FAILED: {
      actions: 'handleActionsExportFailed',
    },
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
