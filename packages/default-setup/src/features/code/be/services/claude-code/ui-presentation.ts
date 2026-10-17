export interface ClaudeUiTextStyle {
  size?: 'caption' | 'footnote' | 'body' | 'heading' | 'title'
  weight?: 'regular' | 'medium' | 'semibold' | 'bold'
  dir?: 'ltr' | 'rtl'
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  mono?: boolean
  tabular?: boolean
  dimColor?: boolean
}

// Inert wire presentation only. No native handles or process dependencies.
export type ClaudeUiNode =
  | { kind: 'text'; text: string; children?: ClaudeUiNode[]; style?: ClaudeUiTextStyle; plugin?: string }
  | { kind: 'link'; href?: string; children: ClaudeUiNode[]; plugin?: string }
  | { kind: 'box'; children: ClaudeUiNode[]; plugin?: string }
  | { kind: 'markdown'; text: string; dim: boolean; actionId?: string; pressableLinks?: string[]; plugin?: string }
  | { kind: 'code'; source: string; language?: string; path?: string; startLine?: number; format: 'source' | 'diff'; wrap: 'wrap' | 'truncate-end'; plugin?: string }
  | { kind: 'button'; label: string; actionId?: string; plugin?: string }
  | { kind: 'input'; actionId: string; revision: number; submitLabel: string; label?: string; placeholder?: string; value: string; rows: number; autoFocus: boolean; plugin?: string }
  | { kind: 'select'; actionId: string; revision: number; label?: string; value: string; options: { value: string; label: string }[]; autoFocus: boolean; plugin?: string }
  | { kind: 'unsupported'; component: string; plugin?: string }

export type ClaudePromptEdit = Omit<import('./ui-controls.ts').ClaudeUiPromptEdit, 'client_id' | 'surface'> & { revision: number }
export type ClaudePromptReply =
  | { revision: number; status: 'applied'; frame: import('./ui-controls.ts').ClaudeUiPromptFrame }
  | { revision: number; status: 'error'; message: string }

export type ClaudeUiFieldEvent = { actionId: string; revision: number; kind: 'change' | 'submit' | 'select'; value: string }

export type ClaudeUiMountState =
  | { status: 'connecting' | 'rendering' | 'disconnected' }
  | { status: 'live'; tree: ClaudeUiNode }
  | { status: 'error'; message: string }

