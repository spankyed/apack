export type ActionParameterType = 'any' | 'string' | 'number' | 'boolean' | 'object' | 'array';

export type ActionParameter = {
  description?: string;
  required?: boolean;
  type: ActionParameterType;
};

export type ActionCategory = {
  color: string;
  name: string;
};

export type ActionEntity = {
  actionFn: string;
  category?: string;
  createdAt?: number;
  description?: string;
  id: string;
  input: Record<string, ActionParameter>;
  label: string;
  output?: string;
  updatedAt?: number;
};

export type ActionFormData = {
  actionFn: string;
  category?: string;
  description?: string;
  input: Record<string, ActionParameter>;
  label: string;
  output?: string;
};

export type ActionsListState = {
  actions: ActionEntity[];
  categories: ActionCategory[];
  hasActions: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  selectedCategories: string[];
};

export type ActionDetailState = {
  action?: ActionEntity;
  categories: ActionCategory[];
  formData: ActionFormData;
  metadataExpanded?: boolean;
  outputExpanded?: boolean;
  parametersExpanded?: boolean;
};

export type ActionsSurfaceState =
  | ({view: 'list'} & ActionsListState)
  | ({view: 'detail' | 'create'} & ActionDetailState);
