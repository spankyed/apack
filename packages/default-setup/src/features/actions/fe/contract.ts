// The actions surface's contract: the state it publishes and what other surfaces may send it.
//
// A leaf: no machine, no other feature, and nothing from `#generated/*` but `types` and `ears` — which is what lets
// codegen read the contract without resolving the machine, whose imports cycle back through `#generated/events`.
// `apack.json` names it at `features[].surface.contract`.
//
// What the surface holds is what the user is doing: which action is open, how far down the list they've read, the
// form they're filling. The actions themselves are the feature's views (`be/views.ts`), which a component reads with
// `useView`, so nothing here is a copy of a row.
import type { SurfaceInbox } from '@apackdev/sdk/fe'
import type { ActionParameter } from '@apackdev/sdk'
import type { EARS } from '#generated/ears.ts'

export interface ActionsContext {
  /** The action open in the detail view */
  selectedActionId?: EARS.EntityId;
  /** The open action's label, for the breadcrumb, as its view last read it */
  selectedLabel?: string;
  /** The action the form was filled from, so its view changing doesn't overwrite what the user has typed */
  formFor?: EARS.EntityId;
  /** How many actions the list shows: a page more each time the user scrolls to its end */
  listLimit: number;
  selectedCategories: string[]; // Filter state

  // Import/Export state
  actionsImport: {
    status: 'idle' | 'importing' | 'success' | 'error';
    errors: string[];
    importedCount: number;
  };
  actionsExport: {
    status: 'idle' | 'exporting' | 'success' | 'error';
    errors: string[];
    filePath: string;
    actionCount: number;
  };

  // Form data for create/edit
  formData: {
    label: string;
    description?: string;
    category?: string;
    input: Record<string, ActionParameter>;
    actionFn: string;
    output?: any;
    parametersExpanded?: boolean;
    outputExpanded?: boolean;
    metadataExpanded?: boolean;
  };
}

/** Opening and editing, which the code surface's actions panel and the action step's form ask of it */
export type ActionsInboxEvent =
  | { type: 'ACTION.CREATE' }
  | { type: 'ACTION.UPDATE_INPUT'; actionId: string; input: Record<string, any> }
  | { type: 'ACTION.UPDATE_LABEL'; actionId: string; label: string }
  | { type: 'ACTION.DELETE'; actionId: EARS.EntityId }
  | { type: 'ACTION.CREATE_INLINE'; label: string; actionFn: string; input: Record<string, any> }
  | { type: 'ACTION.SELECT'; actionId: EARS.EntityId }

export type Contract = {
  opens: 'Action'
  state: ActionsContext
  inbox: SurfaceInbox<{ pack: ActionsInboxEvent }>
}
