import type { OutcomeOf, Read, Value } from '@apackdev/state';
import type { OpenEntity } from '@apackdev/sdk/events';
import { entityIs, type SurfaceChrome, type TrailClickEvent } from '@apackdev/sdk/fe';
import type { ActionEntity, ActionParameter } from '@apackdev/sdk';
import { Trash2 } from 'lucide-vue-next';
import type { EARS } from '#generated/ears.ts';
import { state, type PackNet } from '#generated/state.ts';
import type { Contract, ActionsContext, ActionsInboxEvent } from './contract.ts';

export const id = 'actions' as const;

/** How many more actions the list shows each time the user reaches its end */
export const ACTIONS_PAGE_SIZE = 20;

type ActionsAsks = PackNet['systems']['actions']['asks'];

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
  | { type: 'ACTIONS.FORGET_EXPORT' };

/** What the machine holds: what the surface publishes, and how the last import and export ended */
type ActionsData = Omit<ActionsContext, 'selectedActionId' | 'selectedLabel' | 'formFor'> & {
  selectedActionId: EARS.EntityId | undefined;
  selectedLabel: string | undefined;
  formFor: EARS.EntityId | undefined;
  /** How the last import ended, until another file is picked */
  imported: OutcomeOf<ActionsAsks['IMPORT_ACTIONS']> | undefined;
  /** How the last export ended, until another is made */
  exported: OutcomeOf<ActionsAsks['EXPORT_ACTIONS']> | undefined;
};

type ActionsShape = {
  data: ActionsData;
  calls: {
    createAction: { readonly many: ActionsAsks['CREATE_ACTION']['args'] };
    updateAction: { readonly many: ActionsAsks['UPDATE_ACTION']['args'] };
    deleteAction: { readonly many: ActionsAsks['DELETE_ACTION']['args'] };
    importActions: { readonly one: ActionsAsks['IMPORT_ACTIONS']['args'] };
    exportActions: { readonly one: ActionsAsks['EXPORT_ACTIONS']['args'] };
  };
  states: {
    list: {};
    create: {};
    detail: {};
  };
};

export type ActionsEvents = OpenEntity | UIEvent | TrailClickEvent;

// The list shows no action, so reopening one fills its form afresh from what its view reads then
const CLEAR_SELECTED = {
  selectedActionId: undefined,
  selectedLabel: undefined,
  formFor: undefined,
} as const;

const CREATE_FORM_DATA = {
  label: '',
  description: '',
  category: '',
  input: {},
  actionFn: '// Your action function body here\n// Available services: logger, database, email, http\nreturn { success: true };',
  output: undefined,
};

function selectActionData(currentId: EARS.EntityId | undefined, actionId: EARS.EntityId) {
  if (currentId === actionId) return undefined;
  return { selectedActionId: actionId, selectedLabel: undefined, formFor: undefined };
}

const formUpdateHandlers = {
  'FORM.UPDATE_LABEL': (event: Extract<ActionsEvents, { type: 'FORM.UPDATE_LABEL' }>, { data }: { data: Read<ActionsData> }) => ({
    data: { formData: { ...data.formData, label: event.label } },
  }),
  'FORM.UPDATE_DESCRIPTION': (event: Extract<ActionsEvents, { type: 'FORM.UPDATE_DESCRIPTION' }>, { data }: { data: Read<ActionsData> }) => ({
    data: { formData: { ...data.formData, description: event.description } },
  }),
  'FORM.UPDATE_PARAMETERS': (event: Extract<ActionsEvents, { type: 'FORM.UPDATE_PARAMETERS' }>, { data }: { data: Read<ActionsData> }) => ({
    data: { formData: { ...data.formData, input: event.input } },
  }),
  'FORM.UPDATE_ACTION': (event: Extract<ActionsEvents, { type: 'FORM.UPDATE_ACTION' }>, { data }: { data: Read<ActionsData> }) => ({
    data: { formData: { ...data.formData, actionFn: event.actionFn } },
  }),
  'FORM.UPDATE_OUTPUT': (event: Extract<ActionsEvents, { type: 'FORM.UPDATE_OUTPUT' }>, { data }: { data: Read<ActionsData> }) => ({
    data: { formData: { ...data.formData, output: event.output } },
  }),
  'FORM.UPDATE_CATEGORY': (event: Extract<ActionsEvents, { type: 'FORM.UPDATE_CATEGORY' }>, { data }: { data: Read<ActionsData> }) => ({
    data: { formData: { ...data.formData, category: event.category } },
  }),
};

export const actionsChrome: SurfaceChrome<Value<ActionsShape>> = {
  default: { label: 'Actions', target: 'list' },
  states: {
    list: {
      breadcrumb: { label: 'Actions', target: 'list' },
    },
    create: {
      breadcrumb: { label: 'New Action', target: 'create' },
    },
    detail: {
      breadcrumb: ({ data }) => ({
        label: data.selectedLabel || data.selectedActionId || '',
        target: 'detail',
      }),
      menu: ({ data }) => [
        {
          label: 'Delete Action',
          icon: Trash2,
          event: { type: 'ACTION.DELETE' as const, actionId: data.selectedActionId! },
          iconColor: 'text-red-400',
          confirm: `Are you sure you want to delete "${data.selectedLabel || 'this action'}"?`,
        },
      ],
    },
  },
};

const actionsState = state<ActionsShape, ActionsEvents>()({
  initial: 'list',
  data: {
    selectedActionId: undefined,
    selectedLabel: undefined,
    formFor: undefined,
    imported: undefined,
    exported: undefined,
    listLimit: ACTIONS_PAGE_SIZE,
    writeError: null,
    selectedCategories: [],
    formData: {
      label: '',
      description: '',
      category: '',
      input: {},
      actionFn: '',
      output: undefined,
    },
  },
  calls: ({ one, many }) => ({
    // What a write changed reaches every window through the views, so a landed one needs nothing here;
    // a refused write is shown until dismissed.
    createAction: many('actions', 'CREATE_ACTION', {
      done: (outcome) => (outcome.ok ? undefined : { data: { writeError: outcome.failure.message } }),
    }),
    updateAction: many('actions', 'UPDATE_ACTION', {
      done: (outcome) => (outcome.ok ? undefined : { data: { writeError: outcome.failure.message } }),
    }),
    deleteAction: many('actions', 'DELETE_ACTION', {
      done: (outcome) => (outcome.ok ? undefined : { data: { writeError: outcome.failure.message } }),
    }),
    importActions: one('actions', 'IMPORT_ACTIONS', {
      done: (outcome) => ({ data: { imported: outcome } }),
    }),
    exportActions: one('actions', 'EXPORT_ACTIONS', {
      done: (outcome) => ({ data: { exported: outcome } }),
    }),
  }),
  on: {
    'ACTIONS.IMPORT': (event, { call }) => {
      call('importActions', { actions: event.actions });
      return { data: { imported: undefined } };
    },
    'ACTIONS.FORGET_IMPORT': () => ({ data: { imported: undefined } }),
    'ACTIONS.EXPORT': (event, { call }) => {
      call('exportActions', { directory: event.directory });
      return { data: { exported: undefined } };
    },
    'ACTIONS.FORGET_EXPORT': () => ({ data: { exported: undefined } }),
    CLEAR_WRITE_ERROR: () => ({ data: { writeError: null } }),
    OPEN_ENTITY: (event, { data }) => {
      if (!entityIs<Contract['opens']>({ event }, { entity: 'Action' })) return;
      const updates = selectActionData(data.selectedActionId, event.id as EARS.EntityId);
      return updates ? { at: 'detail', data: updates } : { at: 'detail' };
    },
    'ACTION.SELECT': (event, { data }) => {
      const updates = selectActionData(data.selectedActionId, event.actionId);
      return updates ? { at: 'detail', data: updates } : { at: 'detail' };
    },
    VIEW_LIST: () => ({ at: 'list', data: CLEAR_SELECTED }),
    TOGGLE_PARAMETERS_SECTION: (event, { data }) => ({
      data: { formData: { ...data.formData, parametersExpanded: event.show } },
    }),
    TOGGLE_OUTPUT_SECTION: (event, { data }) => ({
      data: { formData: { ...data.formData, outputExpanded: event.show } },
    }),
    TOGGLE_METADATA_SECTION: (event, { data }) => ({
      data: { formData: { ...data.formData, metadataExpanded: event.show } },
    }),
    'ACTIONS.LOAD_MORE': (_event, { data }) => ({
      data: { listLimit: data.listLimit + ACTIONS_PAGE_SIZE },
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
    'ACTION.UPDATE_INPUT': (event, { call }) => {
      call('updateAction', { actionId: event.actionId, input: event.input });
    },
    'ACTION.CREATE_INLINE': (event, { call }) => {
      call('createAction', { label: event.label, actionFn: event.actionFn, input: event.input });
    },
    'ACTION.UPDATE_LABEL': (event, { call }) => {
      call('updateAction', { actionId: event.actionId, label: event.label });
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
        'ACTION.CREATE': () => ({
          at: 'create',
          data: {
            formData: CREATE_FORM_DATA,
            ...CLEAR_SELECTED,
          },
        }),
        'ACTION.DELETE': (event, { call }) => {
          call('deleteAction', { actionId: event.actionId });
        },
      },
    },
    create: {
      on: {
        ...formUpdateHandlers,
        'ACTION.SAVE': (_event, { data, call }) => {
          if (!data.selectedActionId) call('createAction', data.formData);
          else call('updateAction', { actionId: data.selectedActionId, ...data.formData });
          return { at: 'list', data: CLEAR_SELECTED };
        },
      },
    },
    detail: {
      on: {
        // The open action deleted, here or in another window: there is nothing left to show
        'ACTION.LOADED': (event, { data }) => {
          if (event.actionId !== data.selectedActionId) return;
          if (event.action === null) return { at: 'list', data: CLEAR_SELECTED };
          // The form is filled once per opening: a change the view brings later (another window's edit) leaves what the
          // user is typing alone, and saving writes the form as it stands
          if (data.formFor === event.actionId) return { data: { selectedLabel: event.action.label } };
          return {
            data: {
              selectedLabel: event.action.label,
              formFor: event.actionId,
              formData: {
                label: event.action.label,
                description: event.action.description,
                category: event.action.category,
                input: event.action.input,
                actionFn: event.action.actionFn,
                output: event.action.output,
              },
            },
          };
        },
        ...formUpdateHandlers,
        'ACTION.SAVE': (_event, { data, call }) => {
          if (!data.selectedActionId) call('createAction', data.formData);
          else call('updateAction', { actionId: data.selectedActionId, ...data.formData });
          return { at: 'list', data: CLEAR_SELECTED };
        },
        'ACTION.DELETE': (event, { call }) => {
          call('deleteAction', { actionId: event.actionId });
        },
      },
    },
  },
});

export default actionsState;
