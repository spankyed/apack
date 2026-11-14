export type ChatAttachment = {
  label: string;
  previewUrl?: string;
  typeLabel?: string;
  type: 'file' | 'image';
};

export type ChatComposerState = {
  attachments?: ChatAttachment[];
  bottomTabs?: {
    activeLabel: string;
    newThreadLabel: string;
    recentLabel: string;
  };
  busy?: boolean;
  disabled?: boolean;
  mode: string;
  modeOptions?: ChatModeOption[];
  openSelector?: 'mode' | 'phase';
  phase?: string;
  placeholder: string;
  statusLine?: string;
  text?: string;
};

export type ChatModeOption = {
  disabled?: boolean;
  hidden?: boolean;
  name: string;
  phases?: Array<{
    color?: string;
    name: string;
  }>;
};
