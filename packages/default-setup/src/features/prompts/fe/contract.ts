// The prompts surface's contract: the state it publishes and what other surfaces may send it.
//
// A leaf: no machine, no other feature, and nothing from `#generated/*` but `types` and `ears` — which is what lets
// codegen read the contract without resolving the machine, whose imports cycle back through `#generated/events`.
// `apack.json` names it at `features[].surface.contract`.
//
// What the surface holds is what the user is doing: which prompt is open, how far down the list they've read, the
// form they're filling. The prompts themselves are the feature's views (`be/views.ts`), which a component reads with
// `useView`, so nothing here is a copy of a row.
import type { SurfaceInbox } from '@apackdev/sdk/fe'
import type { TemplateInput } from '@apackdev/sdk'
import type { EARS } from '#generated/ears.ts'

export interface PromptsContext {
  /** The prompt open in the detail view */
  selectedPromptId?: EARS.EntityId;
  /** The open prompt's label, for the breadcrumb, as its view last read it */
  selectedLabel?: string;
  /** The prompt the form was filled from, so its view changing doesn't overwrite what the user has typed */
  formFor?: EARS.EntityId;
  /** How many prompts the list shows: a page more each time the user scrolls to its end */
  listLimit: number;
  selectedCategories: string[]; // Filter state

  // Import/Export state
  promptsImport: {
    status: 'idle' | 'importing' | 'success' | 'error';
    errors: string[];
    importedCount: number;
  };
  promptsExport: {
    status: 'idle' | 'exporting' | 'success' | 'error';
    errors: string[];
    filePath: string;
    promptCount: number;
  };

  // Form data for create/edit
  formData: {
    label: string;
    description?: string;
    category?: string;
    inputs: Record<string, TemplateInput>;
    templateFn: string;
    outputSchema?: any;
    inputsExpanded?: boolean;
    outputExpanded?: boolean;
    metadataExpanded?: boolean;
  };
}

/** Editing, which the code surface's prompts panel asks of it */
export type PromptsInboxEvent =
  | { type: 'PROMPT.UPDATE_INPUTS'; promptId: string; inputs: Record<string, any> }
  | { type: 'PROMPT.UPDATE_LABEL'; promptId: string; label: string }
  | { type: 'PROMPT.DELETE'; promptId: EARS.EntityId }
  | { type: 'PROMPT.CREATE_INLINE'; label: string; templateFn: string; inputs: Record<string, any> }
  | { type: 'PROMPT.SELECT'; promptId: EARS.EntityId }

export type Contract = {
  opens: 'Prompt'
  state: PromptsContext
  inbox: SurfaceInbox<{ pack: PromptsInboxEvent }>
}
