import type {ActionCategory, ActionParameterType} from '../actions/actionTypes';

export type TemplateInput = {
  description?: string;
  name: string;
  required?: boolean;
  type: ActionParameterType;
};

export type PromptEntity = {
  category?: string;
  createdAt?: number;
  description?: string;
  id: string;
  inputs: Record<string, TemplateInput>;
  label: string;
  outputSchema?: string;
  templateFn: string;
  updatedAt?: number;
};

export type PromptFormData = {
  category?: string;
  description?: string;
  inputs: Record<string, TemplateInput>;
  label: string;
  outputSchema?: string;
  templateFn: string;
};

export type PromptsListState = {
  categories: ActionCategory[];
  hasMore: boolean;
  hasPrompts: boolean;
  loadingMore: boolean;
  prompts: PromptEntity[];
  selectedCategories: string[];
};

export type PromptDetailState = {
  categories: ActionCategory[];
  formData: PromptFormData;
  inputsExpanded?: boolean;
  metadataExpanded?: boolean;
  outputExpanded?: boolean;
  prompt?: PromptEntity;
};

export type PromptsSurfaceState =
  | ({view: 'list'} & PromptsListState)
  | ({view: 'detail' | 'create'} & PromptDetailState);
