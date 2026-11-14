export type BrowserTabGroupColor =
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'gray';

export type BrowserTabGroup = {
  color: BrowserTabGroupColor;
  id: string;
  isCollapsed?: boolean;
  name: string;
  order: number;
};

export type BrowserTabState = {
  canGoBack?: boolean;
  canGoForward?: boolean;
  favicon?: string;
  groupId?: string;
  id: number;
  isLoading?: boolean;
  isMuted?: boolean;
  title?: string;
  url: string;
};

export type BrowserAutocompleteSuggestion = {
  favicon?: string;
  title?: string;
  url: string;
};

export type BrowserPageState = {
  accent?: string;
  cards?: Array<{label: string; value: string}>;
  eyebrow?: string;
  heading: string;
  rows?: Array<{label: string; value: string}>;
  status?: string;
  subheading?: string;
};

export type BrowserSurfaceState = {
  activeTabId: number | null;
  addressBarValue: string;
  addressFocused?: boolean;
  inlineCompletion?: string | null;
  page?: BrowserPageState;
  selectedSuggestionIndex?: number;
  suggestions?: BrowserAutocompleteSuggestion[];
  tabGroups?: BrowserTabGroup[];
  tabs: BrowserTabState[];
};
