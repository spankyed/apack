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

export interface ClaudeUiBoxPaint {
  borderStyle?: string
  borderColor?: string
  borderDimColor?: boolean
  backgroundColor?: string
}

export type ClaudeUiTextWrap = 'wrap' | 'end' | 'middle' | 'truncate' | 'truncate-start' | 'truncate-middle' | 'truncate-end'

export interface ClaudeUiTextStyle {
  wrap?: ClaudeUiTextWrap
  color?: string
  backgroundColor?: string
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
  inverse?: boolean
}

export interface ClaudeUiHover {
  group?: string
  text?: Pick<ClaudeUiTextStyle, 'color' | 'backgroundColor' | 'dimColor' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'inverse'>
  paint?: ClaudeUiBoxPaint
  layout?: Pick<ClaudeUiBoxLayout, 'display' | 'top' | 'left' | 'right' | 'bottom'>
}

// Inert wire presentation only. No native handles or process dependencies.
export type ClaudeUiNode =
  | { kind: 'image'; columns: number; rows: number; alt: string; format: 'png' | 'rgba'; data: string; width?: number; height?: number; plugin?: string }
  | { kind: 'raster'; columns: number; rows: number; nativeAnsi: string; plugin?: string }
  | { kind: 'client'; id: string; pointer: boolean; keys: boolean; layout?: Pick<ClaudeUiBoxLayout,'width'|'height'|'flexGrow'>; children: ClaudeUiNode[]; plugin?: string }
  | { kind: 'text'; hover?: ClaudeUiHover; text: string; children?: ClaudeUiNode[]; style?: ClaudeUiTextStyle; plugin?: string }
  | { kind: 'svg'; source: string; alt: string; width?: number; height?: number; interactive: boolean; plugin?: string }
  | { kind: 'link'; color?: string; href?: string; children: ClaudeUiNode[]; plugin?: string }
  | { kind: 'box'; scrollId?: string; boxKey?: string | false; hover?: ClaudeUiHover; layout?: ClaudeUiBoxLayout; paint?: ClaudeUiBoxPaint; children: ClaudeUiNode[]; plugin?: string }
  | { kind: 'markdown'; formattingFallback?: boolean; nativeAnsi?: string; color?: string; text: string; dim: boolean; actionId?: string; pressableLinks?: string[]; plugin?: string }
  | { kind: 'code'; formattingFallback?: boolean; color?: string; nativeAnsi?: string; source: string; language?: string; path?: string; startLine?: number; format: 'source' | 'diff'; wrap: 'wrap' | 'truncate-end'; plugin?: string }
  | { kind: 'button'; expanded?: boolean; color?: string; hotkeyColor?: string; focusId?: string; hover?: ClaudeUiHover; label: string; hotkey?: string; children?: ClaudeUiNode[]; dimColor?: boolean; variant?: 'primary' | 'secondary'; role?: 'dismiss'; autoFocus?: boolean; actionId?: string; plugin?: string }
  | { kind: 'input'; theme?: { text: string; inverseText: string }; focusId?: string; actionId: string; revision: number; submitLabel: string; label?: string; placeholder?: string; value: string; rows: number; autoFocus: boolean; plugin?: string }
  | { kind: 'select'; theme?: { text: string; inverseText: string }; focusId?: string; actionId: string; revision: number; label?: string; value?: string; options: { value: string; label: string }[]; autoFocus: boolean; plugin?: string }
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

export interface ClaudeUiScrollEvent {
  paneId?: string
  revision: number
  offset: number
  by: number
  rows: number
  contentRows: number
  pointer?: { column: number; row: number }
  keyed: { id: string; top: number; bottom: number }[]
}
export interface ClaudeUiScrollState { serial: number; requestRevision?: number; offset: number; followEnd: boolean }
export interface ClaudeUiPanePresentation {
  scroll?: ClaudeUiScrollState
  roster: import('./ui-controls.ts').ClaudeUiPaneRoster
  body: { status: 'connecting' | 'rendering' | 'error'; message?: string } | { status: 'live'; tree: ClaudeUiNode }
}
export type ClaudeUiPaneEvent = { kind: 'show' | 'focus' | 'close'; id: string | null }
  | { kind: 'layout'; id: string; columns: number; rows: number; offset: number }
export type ClaudeUiNoticeEvent = { kind: 'dismiss'; id: string } | { kind: 'hold'; id: string; isHeld: boolean }

export interface ClaudeUiNotices {
  statuses: { plugin: string; text: string }[]
  toasts: { id: string; plugin: string; text: string; title?: string }[]
}

interface ClaudeUiTranscriptRowSource {
  producerRevision?: string
  messageId: string
  uuid: string
  sessionId: string
  text: string
  start: number
  end: number
}
/** Existing app tool data carried to a canonical native group's default drawing. */
export interface ClaudeUiGroupedTool {
  id: string; tool: string; summary: string; status: 'running' | 'ok' | 'denied' | 'error'
  durationMs?: number; outputSummary?: string
  nativeAgent?: { id: string; ownerId?: string; sessionId?: string; name: string; status: string; statusText?: string }
  nativeResult?: { uuid: string; sessionId: string }
  details?: { input?: unknown; output?: string; error?: string }
}
export type ClaudeUiTranscriptRow = ClaudeUiTranscriptRowSource & (
  | { component: 'AssistantMessage'; isFirstOfReply: boolean; isSummary?: false }
  | { component: 'AssistantMessage'; isFirstOfReply: boolean; isSummary: true; blockIndex: number }
  | { component: 'ToolUse'; blockIndex: number; assistantUuid: string; activityStatus: string; resultUuid?: string }
  | { component: 'ToolProgress'; blockIndex: number; assistantUuid: string; activityStatus: string; resultUuid?: string }
  | { component: 'ToolGroup'; blockIndex: number; revision: string; isExpanded: boolean; isActive: boolean; usesEngine: boolean; tools: ClaudeUiGroupedTool[]; artifacts: { artifactId: string; label: string }[] }
  | { component: 'ToolResult'; blockIndex: number; assistantUuid: string; resultUuid: string; tool: string; isErrored: boolean }
  | { component: 'CommandOutput'; isErrored: boolean }
  | { component: 'Spinner' | 'SessionMode' | 'PromptHint'; sourceRevision: string }
  | { component: 'TurnDuration' | 'InfoNotice'; sourceRevision: string }
  | { component: 'UserMessage'; origin: { kind: string; name?: string; asUser?: boolean; server?: string }; isExpanded: boolean }
)
export interface ClaudeUiTranscriptLayout {
  component: 'ToolUse' | 'ToolResult' | 'ToolProgress' | 'ToolGroup'
  uuid: string
  instanceRevision: number
  columns: number
}
export type ClaudeUiTranscriptFrame = ClaudeUiTranscriptRow & {
  instanceRevision: number
  nativeHint?: boolean
  groupExpanded?: boolean
  displayText: string
  outputRewritten?: boolean
  engineOutput?: string
  body: { status: 'rendering' | 'error' } | { status: 'live'; tree: ClaudeUiNode }
}

export interface ClaudeUiQuestionRow { messageId: string; id: string; revision: string; sessionId: string; requestId: string }
export interface ClaudeUiQuestionFrame {
  messageId: string; id: string; revision: string; draftActionId: string; token?: string;
  shownInput?: Record<string, unknown>;
  presentation?: import('../../../common/native-question.ts').ClaudeQuestionPresentation;
  body: { status: 'rendering' } | { status: 'live'; tree: ClaudeUiNode } | { status: 'error'; message: string }
}
export type ClaudeUiMountState = (
  | { status: 'connecting' | 'rendering' | 'disconnected' }
  | { status: 'live'; tree: ClaudeUiNode }
  | { status: 'error'; message: string }
) & { billing?: import('../../../common/native-billing.ts').ClaudeBillingObservation; actionKeys?: import('./ui-controls.ts').ClaudeUiActionKeyState; promptPalette?: Record<string, string>; agent?: import('../../../common/native-terminal.ts').ClaudeNativeTaskDetails; agentProblem?: string; agentInput?: { revision: number; status: 'pending' | 'done' | 'error' | 'review' | 'blocked' | 'confirmation' | 'deciding' | 'command_done' | 'command_output' | 'panel' | 'panel_done'; panel?: { id: string; commandName: string }; backgroundReview?: import('../../../common/native-background.ts').ClaudeBackgroundReviewState; settings?: import('../../../common/native-settings.ts').ClaudeSettingsView; output?: { messageId: string; commandName: string; text: string; isErrored: boolean; outcome?: string }; receipt?: { messageId: string }; command?: import('../../../common/native-terminal.ts').ClaudeNativeAgentCommandConfirmation; decision?: 'confirm' | 'cancel'; review?: import('../../../common/native-terminal.ts').ClaudeNativeAgentInputReview; problem?: string }; composer?: ClaudeUiTranscriptFrame[]; panes?: ClaudeUiPanePresentation; scroll?: ClaudeUiScrollState; notices?: ClaudeUiNotices; managedSettingsDiagnostics?: import('./ui-controls.ts').ClaudeManagedSettingsDiagnostic[]; diagnostics?: (import('./ui-controls.ts').ClaudeUiDiagnosticAttachment & {messageId:string})[]; transcriptMessages?: ClaudeUiTranscriptFrame[]; question?: ClaudeUiQuestionFrame }

/** Opaque current-drawing focus identity; absence reports hold only, null selects the container. */
export type ClaudeUiFocusEvent = { paneId?: string; revision: number; isHeld: boolean; focusId?: string | null; by: 'person' | 'auto' }
export type ClaudeUiFocusReply = { paneId?: string; revision: number; moved: boolean; focusId: string | null; deny?: string }

export type ClaudePromptHostRequest = { requestId: string; revision: number; expiresAt: number } & (
  | { kind: 'read' }
  | { kind: 'fill'; input: import('./ui-prompt-host.ts').ClaudePromptHostFill }
  | { kind: 'suggest'; text: string }
  | { kind: 'copy'; text: string }
  | { kind: 'selection'; replyUrl: string }
)
export type ClaudePromptHostResponse = { requestId: string } & (
  | { kind: 'read'; box?: import('./ui-prompt-host.ts').ClaudePromptHostBox }
  | { kind: 'fill'; filled: boolean }
  | { kind: 'suggest'; shown: boolean }
  | { kind: 'copy'; copied: boolean }
  | { kind: 'selection'; submitted: boolean }
)

export interface ClaudeUiClientEvent { id: string; sequence: number; event: import('./ui-controls.ts').ClaudeUiClientInput }
