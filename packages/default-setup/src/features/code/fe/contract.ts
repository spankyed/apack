// The code surface's contract: the state it publishes and what other surfaces may send it.
//
// A leaf: no machine, no other feature, and nothing from `#generated/*` but `types` and `ears` — which is what lets
// codegen read the contract without resolving the machine, whose imports cycle back through `#generated/events`.
// The tab shapes live here too, because the published state holds them and the child machines that used to declare
// them reach `#generated/events`. `apack.json` names it at `features[].surface.contract`.
import type { HotkeysMap, NavHistory, SurfaceInbox, TabGroup } from '@apackdev/sdk/fe'
import type { ActionEntity, PromptEntity } from '@apackdev/sdk'
import type { EARS } from '#generated/ears.ts'
import type { CodeSettings } from '#generated/types.ts'
import type { GitDiff, GitStatusFile, TerminalInfo } from '../be/types.ts'

export interface OpenFile {
  path: string
  content: string
  originalContent: string  // Content when file was opened or last saved
  modified: boolean
  isDiff?: boolean
  gitDiff?: GitDiff
  gitFile?: GitStatusFile
  externallyModified?: boolean
  externalModificationTime?: Date
  pendingSaveConflict?: boolean
  isImage?: boolean
  isVideo?: boolean
  isBinary?: boolean
  isRichText?: boolean
  _richTextBaselineSet?: boolean
  isPrDiff?: boolean
  isPinned?: boolean
  groupId?: string
  isPreview?: boolean
}

export interface TerminalTab extends OpenFile {
  isTerminal: true
  terminalInfo: TerminalInfo
}

export interface QuickOpenResult {
  path: string
  relativePath: string
  name: string
  type: 'file' | 'directory'
  extension?: string
  score?: number
  matchRanges?: Array<[number, number]> // For highlighting matches
}

export type PanelType = 'explorer' | 'search' | 'commit' | 'pr' | 'actions' | 'prompts';

export interface ActionTab {
  path: string
  content: string
  modified: boolean
  isAction: true
  actionEntity: ActionEntity
  // Include OpenFile properties to satisfy type constraints
  isDiff?: boolean
  externallyModified?: boolean
  externalModificationTime?: Date
  pendingSaveConflict?: boolean
  isPinned?: boolean
  groupId?: string
  isPreview?: boolean
}

export interface PromptTab {
  path: string
  content: string
  modified: boolean
  isPrompt: true
  promptEntity: PromptEntity
  // Include OpenFile properties to satisfy type constraints
  isDiff?: boolean
  externallyModified?: boolean
  externalModificationTime?: Date
  pendingSaveConflict?: boolean
  isPinned?: boolean
  groupId?: string
  isPreview?: boolean
}

export type CodeContext = {
  /**
   * Whether this window is the one that keeps the app's layout (M5).
   *
   * Every window has its own copy of the window storage but they share its names, so two windows showing
   * this surface kept their tabs under one key: each restored the other's and each rewrote them. The shell
   * answers it on `SURFACE_STARTED` — the same fact it records the last-open surface by — and a popout
   * reads the layout and writes none. Defaults true, since a window that was never told is the only one.
   */
  ownsAppLayout: boolean
  baseDirectory: string
  openFiles: (OpenFile | TerminalTab | ActionTab | PromptTab)[]
  activeFilePath: string | null
  isLoading: boolean
  error: string | null
  selectedPanel: PanelType
  tabsRestored?: boolean
  pendingTabOrder?: Array<{ path: string; order: number }>  // Track desired tab order during restoration
  pendingPersistedMetadata?: Map<string, { groupId?: string; isPinned?: boolean; isPreview?: boolean }>  // Track metadata to apply after restoration
  // Tab groups state
  tabGroups: TabGroup[]
  // Quick open state
  isQuickOpenVisible: boolean
  quickOpenQuery: string
  quickOpenResults: QuickOpenResult[]
  quickOpenSelectedIndex: number
  quickOpenLoading: boolean
  recentlyOpenedFiles: string[]
  tabViewHistory: string[]
  hotkeys: HotkeysMap
  settings?: CodeSettings
  pendingRevealLine: { filePath: string; line: number; column: number; lineText?: string } | null
  searchFocusTrigger: number
  searchPrefillText: string
  panelTerminalId: string | null
  panelTerminalExpanded: boolean
  pendingTerminalTabIds?: string[]
  panelNavHistory: NavHistory<PanelType>
}

/**
 * What other features ask of the code surface: which panel to show, a write to its state, and a job for one of its
 * children. The `<child>.*` events aren't in this machine's own union — it routes them to its child actors by
 * prefix — so they are spelled out, and each names the child that handles it.
 */
export type CodeInboxEvent =
  | { type: 'UPDATE_STATE'; updates: Partial<CodeContext> }
  /**
   * Open a terminal. Every field is optional because the surface's own senders pass `cwd` alone, and
   * `target` is the literal the child acts on rather than any string: it routes `'tab'` to a tab and
   * anything absent to the panel.
   */
  | { type: 'terminal.CREATE'; title?: string; cwd?: string; target?: 'tab'; command?: string }
  | { type: 'explorer.SET_BASE_DIRECTORY'; path: string }
  | { type: 'codeActions.OPEN_ACTION'; actionId: EARS.EntityId }
  | { type: 'codePrompts.OPEN_PROMPT'; promptId: EARS.EntityId }

export type Contract = {
  opens: 'CodeSymbol'
  state: CodeContext
  inbox: SurfaceInbox<{ pack: CodeInboxEvent }>
}
