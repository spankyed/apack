import type {CSSProperties} from 'react';
import type {ReferenceCategory, ReferenceRefType} from './referenceConfig';

export type ChatFileAttachment = {
  label: string;
  previewUrl?: string;
  style?: CSSProperties;
  typeLabel?: string;
  type: 'file';
};

export type ChatImageAttachment = {
  label: string;
  previewUrl: string;
  style?: CSSProperties;
  typeLabel?: string;
  type: 'image';
};

export type ChatAttachment = ChatFileAttachment | ChatImageAttachment;

export type QuickPromptState = {
  id: string;
  text: string;
};

export type RevertHistoryMessageState = {
  canSummarize?: boolean;
  createdAt?: number | string;
  id: string;
  selected?: boolean;
  text: string;
};

export type {ReferenceCategory, ReferenceRefType};

export type ChatComposerInlineNode =
  | {
      text: string;
      type: 'text';
    }
  | {
      label: string;
      refId: string;
      refType: ReferenceRefType;
      selected?: boolean;
      shortCode: string;
      type: 'reference';
    };

export type ChatComposerState = {
  attachments?: ChatAttachment[];
  bottomTabs?: {
    active?: 'active' | 'new' | 'recent';
    activeEditing?: boolean;
    activeLabel: string;
    newThreadMenu?: {
      openSubmenu?: 'child' | 'project';
      popupPosition?: {
        bottom?: number;
        left: number;
        top?: number;
      };
      projects: Array<{
        color: string;
        directories: string[];
        name: string;
      }>;
      threads: Array<{
        id: string;
        shortCode?: string;
        timestamp: number;
        topic: string;
      }>;
    };
    pressed?: 'active' | 'new' | 'recent';
    recentThreadsMenu?: {
      archiveContextMenuThreadId?: string;
      contextMenu?: {
        isArchived?: boolean;
        popupPosition?: {
          bottom?: number;
          left: number;
          top?: number;
        };
        threadId: string;
      };
      currentId?: string;
      editingName?: string;
      editingThreadId?: string;
      archiveContextMenuPosition?: {
        bottom?: number;
        left: number;
        top?: number;
      };
      popupPosition?: {
        bottom: number;
        left: number;
        width: number;
      };
      selectedIndex?: number;
      threadStates?: Record<string, {
        busy?: boolean;
        color?: string;
      }>;
      threads: Array<{
        id: string;
        pinned?: boolean;
        shortCode?: string;
        timestamp: number;
        topic: string;
      }>;
    };
  };
  busy?: boolean;
  chatStatus?: {
    busy?: boolean;
    color: string;
  };
  commandActive?: boolean;
  commandSuggestion?: {
    activeIndex?: number;
    anchorCharacterIndex?: number;
    popupPosition?: {
      bottom?: number;
      left: number;
      top?: number;
    };
    query: string;
    suggestions: Array<{
      name: string;
    }>;
  };
  disabled?: boolean;
  dropActive?: boolean;
  forcedMode?: string;
  mode: string;
  modeOptions?: ChatModeOption[];
  openSelector?: 'mode' | 'more-actions' | 'phase';
  phase?: string;
  placeholder: string;
  content?: ChatComposerInlineNode[];
  referenceAutocomplete?: ReferenceAutocompleteState;
  referenceButtonPressed?: boolean;
  quickPrompts?: QuickPromptState[];
  quickPromptsButtonPressed?: boolean;
  quickPromptsEditing?: boolean;
  quickPromptsEditingId?: string;
  quickPromptsEditingText?: string;
  quickPromptsNewText?: string;
  quickPromptsOpen?: boolean;
  quickPromptsSelectedIndex?: number;
  recording?: boolean;
  revertHistory?: {
    level?: 'actions' | 'messages';
    messages: RevertHistoryMessageState[];
    popupPosition?: {
      bottom: number;
      left: number;
      maxWidth?: number;
    };
    selectedAction?: 'revert' | 'revert-with-files' | 'summarize-from-here';
    selectedMessageId?: string;
  };
  sendPressed?: boolean;
  speechSupported?: boolean;
  statusLine?: string;
  text?: string;
};

export type ReferenceAutocompleteState = {
  anchorCharacterIndex: number;
  categoryQuery: string;
  popupPosition?: {
    bottom?: number;
    left: number;
    top?: number;
  };
  query: string;
  selectedIndex?: number;
  variant?: 'chat' | 'full';
} & (
  | {
      level: 'category';
      selectedCategory: null;
      suggestions: ReferenceCategory[];
    }
  | {
      level: 'items';
      selectedCategory: ReferenceCategory;
      suggestions: Array<{
        id: string;
        label: string;
        shortCode: string;
        type: ReferenceRefType;
      }>;
    }
);

export type ChatModeOption = {
  disabled?: boolean;
  hidden?: boolean;
  name: string;
  phases?: Array<{
    color?: string;
    name: string;
  }>;
};
