export interface ClaudeUiBoxLayout {
  position?: 'relative' | 'absolute'
  top?: number
  bottom?: number
  left?: number
  right?: number
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  flexGrow?: number
  flexShrink?: number
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse'
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch'
  alignSelf?: 'flex-start' | 'center' | 'flex-end' | 'auto'
  justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly'
  display?: 'flex' | 'none'
  overflow?: 'visible' | 'hidden'
  width?: number | string
  height?: number | string
  minWidth?: number | string
  minHeight?: number | string
  gap?: number | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  columnGap?: ClaudeUiBoxLayout['gap']
  rowGap?: ClaudeUiBoxLayout['gap']
  margin?: ClaudeUiBoxLayout['gap']
  marginX?: ClaudeUiBoxLayout['gap']
  marginY?: ClaudeUiBoxLayout['gap']
  marginTop?: ClaudeUiBoxLayout['gap']
  marginBottom?: ClaudeUiBoxLayout['gap']
  marginLeft?: ClaudeUiBoxLayout['gap']
  marginRight?: ClaudeUiBoxLayout['gap']
  padding?: ClaudeUiBoxLayout['gap']
  paddingX?: ClaudeUiBoxLayout['gap']
  paddingY?: ClaudeUiBoxLayout['gap']
  paddingTop?: ClaudeUiBoxLayout['gap']
  paddingBottom?: ClaudeUiBoxLayout['gap']
  paddingLeft?: ClaudeUiBoxLayout['gap']
  paddingRight?: ClaudeUiBoxLayout['gap']
}

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
  | { kind: 'svg'; source: string; alt: string; width?: number; height?: number; interactive: boolean; plugin?: string }
  | { kind: 'link'; href?: string; children: ClaudeUiNode[]; plugin?: string }
  | { kind: 'box'; layout?: ClaudeUiBoxLayout; children: ClaudeUiNode[]; plugin?: string }
  | { kind: 'markdown'; text: string; dim: boolean; actionId?: string; pressableLinks?: string[]; plugin?: string }
  | { kind: 'code'; source: string; language?: string; path?: string; startLine?: number; format: 'source' | 'diff'; wrap: 'wrap' | 'truncate-end'; plugin?: string }
  | { kind: 'button'; label: string; children?: ClaudeUiNode[]; dimColor?: boolean; variant?: 'primary' | 'secondary'; role?: 'dismiss'; autoFocus?: boolean; actionId?: string; plugin?: string }
  | { kind: 'input'; actionId: string; revision: number; submitLabel: string; label?: string; placeholder?: string; value: string; rows: number; autoFocus: boolean; plugin?: string }
  | { kind: 'select'; actionId: string; revision: number; label?: string; value: string; options: { value: string; label: string }[]; autoFocus: boolean; plugin?: string }
  | { kind: 'unsupported'; component: string; plugin?: string }

export type ClaudePromptEdit = Omit<import('./ui-controls.ts').ClaudeUiPromptEdit, 'client_id' | 'surface'> & { revision: number }
export type ClaudePromptCompletionRow = import('./ui-controls.ts').ClaudeUiPromptCompletions['suggestions'][number]
export type ClaudePromptCompletionRequest = Omit<import('./ui-controls.ts').ClaudeUiPromptAutocomplete, 'client_id' | 'surface'> & { revision: number }
export type ClaudePromptCompletionReply =
  | { revision: number; status: 'ready'; result: import('./ui-controls.ts').ClaudeUiPromptCompletions }
  | { revision: number; status: 'error'; message: string }

export type ClaudePromptReply =
  | { revision: number; status: 'applied'; frame: import('./ui-controls.ts').ClaudeUiPromptFrame }
  | { revision: number; status: 'error'; message: string }

export type ClaudeUiFieldEvent = { actionId: string; revision: number; kind: 'change' | 'submit' | 'select'; value: string }

export type ClaudeUiMountState =
  | { status: 'connecting' | 'rendering' | 'disconnected' }
  | { status: 'live'; tree: ClaudeUiNode }
  | { status: 'error'; message: string }

