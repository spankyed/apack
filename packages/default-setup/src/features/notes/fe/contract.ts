// The notes surface's contract: the state it publishes and what other surfaces may send it.
//
// A leaf: it imports no machine, no other feature and nothing from `#generated/*` but `types` and `ears`, which is
// what lets codegen read the contract without resolving the machine — whose own imports cycle back through
// `#generated/events`. `apack.json` names it at `features[].surface.contract`.
import type { NavHistory, SurfaceInbox, ViewWrites } from '@apackdev/sdk/fe'
import type { NoteSummary } from '#generated/types.ts'

export interface NotesContext {
  /** Every note as the tree shows it: the tree view's last result, with this window's edits on top */
  notes: NoteSummary[]
  /**
   * The text of the notes open in the editor (the open note, the selected task), by id: each one's note view's last
   * result, with this window's typing on top
   */
  contents: Record<string, string>
  /**
   * This window's writes, and the notes views' results held behind those still unanswered (`ViewWrites`,
   * `@apackdev/sdk/fe`): a result that may predate a write would undo an edit on screen. The canvas reads its views
   * again on each of its `refreshes`.
   */
  writes: ViewWrites
  /** The note this window last created, which opens with its title selected */
  createdNoteId: string | null
  currentNoteId: string | null
  currentNote: NoteSummary | null
  expandedNodeIds: string[]
  taskExpandedNodeIds: string[]
  pendingSubDocumentInsert: { cursorPos: number } | null
  lastSubDocumentInsertChildId: string | null
  selectedNoteIds: string[]
  selectedTaskId: string | null
  selectedTask: NoteSummary | null
  notesImport: { status: 'idle' | 'importing' | 'success' | 'error'; errors: string[]; importedCount: number }
  notesExport: { status: 'idle' | 'exporting' | 'success' | 'error'; errors: string[]; filePath: string; itemCount: number }
  showTrash: boolean
  noteScrollPositions: Record<string, number>
  panelSearchActive: boolean
  navHistory: NavHistory<string | null>
  viewedNoteId: string | null
}

/** Where an editor link to a note, task or task list lands */
export type NotesInboxEvent = { type: 'NOTE.OPEN'; noteId: string }

export type Contract = {
  opens: 'Note'
  state: NotesContext
  inbox: SurfaceInbox<{ pack: NotesInboxEvent }>
}
