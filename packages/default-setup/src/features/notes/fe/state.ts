import { entityIs, viewRead, viewWrites, writeEnded, writeSent, writing } from '@apackdev/sdk/fe'
import type { OpenEntity, UntypedAskOutcome } from '@apackdev/sdk/events'
import { randomId } from '@apackdev/sdk/utils/pure'
import { assign, enqueueActions, setup, type ActorRefFrom } from 'xstate'
import breadcrumb, { breadcrumbList } from '@apackdev/sdk/fe'
import { safeEvents } from '@apackdev/sdk/fe'
import {
  targetIs,
  type TrailClickEvent,
} from '@apackdev/sdk/fe'
import type { NoteDTO, NoteSummary } from '#generated/types.ts'
import type { Contract, NotesContext, NotesInboxEvent } from './contract.ts'
import type { NoteSummary as CreatedNote } from '#features/notes/be/types.ts'
import { fromAsk, sendToSystem, type ask } from '#generated/events.ts'
import { Trash2 } from 'lucide-vue-next'
import { contextMenuFn } from '@apackdev/sdk/fe'
import { createNavHistory, pushNavHistory, goBack, goForward, canGoBack, canGoForward } from '@apackdev/sdk/fe'

export const id = 'notes' as const;
export type NotesState = ActorRefFrom<typeof notesState>

/** How a CREATE_NOTE this window asked for ended */
type NoteCreation = Awaited<ReturnType<typeof ask<'notes', 'CREATE_NOTE'>>>

// Every write is an ask the machine spawns, named for whether it creates a note: its done event carries the name
// back, which is what its write was recorded under, and how it ended.
type CreateEnded = { type: `xstate.done.actor.create.${string}`; output: NoteCreation; actorId: string }
type WriteEnded = { type: `xstate.done.actor.write.${string}`; output: UntypedAskOutcome; actorId: string }
const CREATE_ENDED = 'xstate.done.actor.create.*'
const WRITE_ENDED = 'xstate.done.actor.write.*'
const createId = (): string => `create.${randomId()}`
const writeId = (): string => `write.${randomId()}`

type UIEvent =
  | { type: 'NOTE.SELECT'; noteId: string }
  | NotesInboxEvent
  | { type: 'NOTE.CREATE'; parentId?: string; title?: string; content?: string; displayOrder?: number }
  | { type: 'NOTE.CREATE_TASKLIST'; parentId?: string }
  | { type: 'NOTE.DELETE'; noteId: string }
  | { type: 'NOTE.SOFT_DELETE'; noteId: string }
  | { type: 'NOTE.RESTORE'; noteId: string }
  | { type: 'NOTE.UPDATE_CONTENT'; noteId: string; content: string }
  | { type: 'NOTE.UPDATE_TITLE'; noteId: string; title: string }
  | { type: 'NOTE.UPDATE_ICON'; noteId: string; icon: string | null }
  | { type: 'NOTE.TOGGLE_EXPAND'; nodeId: string }
  | { type: 'NOTE.LINK_CLICKED'; noteId: string }
  | { type: 'NOTE.REQUEST_DOCUMENT_INSERT'; parentId: string; cursorPos: number }
  /** What the tree view read, which the canvas hands on: every note as the tree shows it */
  | { type: 'NOTES.READ'; notes: NoteSummary[] }
  /** What an open note's view read: the note with its text, or `null` once it's gone */
  | { type: 'NOTE.READ'; noteId: string; note: NoteDTO | null }
  | { type: 'NOTE.TOGGLE_SELECT'; noteId: string }
  | { type: 'NOTE.RANGE_SELECT'; noteIds: string[] }
  | { type: 'NOTE.CLEAR_SELECTION' }
  | { type: 'NOTE.MOVE'; noteIds: string[]; newParentId: string | null }
  | { type: 'NOTE.REORDER'; noteId: string; newParentId: string | null; newIndex: number }
  | { type: 'TASK.SELECT'; taskId: string }
  | { type: 'TASK.DESELECT' }
  | { type: 'TASK.CREATE'; parentId: string }
  | { type: 'TASK.DELETE'; taskId: string }
  | { type: 'TASK.TOGGLE_COMPLETE'; taskId: string }
  | { type: 'TASK.UPDATE_CONTENT'; taskId: string; content: string }
  | { type: 'TASK.UPDATE_TITLE'; taskId: string; title: string }
  | { type: 'TASK.TOGGLE_SHOW_COMPLETED' }
  | { type: 'TASK.TOGGLE_HIDE_COMPLETED_CHILDREN'; nodeId: string }
  | { type: 'TASK.TOGGLE_EXPAND'; nodeId: string }
  | { type: 'NOTE.TOGGLE_FAVORITE'; noteId: string }
  | { type: 'VIEW_WELCOME' }
  | { type: 'NOTE.SHOW_TRASH' }
  | { type: 'NOTE.HIDE_TRASH' }
  | { type: 'NOTE.PERMANENTLY_DELETE'; noteId: string }
  | { type: 'NOTE.EMPTY_TRASH' }
  | { type: 'NOTE.SAVE_SCROLL'; noteId: string; scrollTop: number }
  | { type: 'NOTE.TOGGLE_PANEL_SEARCH' }
  | { type: 'NAVIGATE_BACK' }
  | { type: 'NAVIGATE_FORWARD' }

export type NotesEvents = OpenEntity | UIEvent | CreateEnded | WriteEnded | TrailClickEvent<string>
const typeOf = safeEvents<NotesEvents>()

function findNearestTaskList(notes: NoteSummary[], noteId: string): NoteSummary | null {
  let currentId: string | null = noteId
  while (currentId) {
    const note = notes.find(n => n.id === currentId)
    if (!note || !note.parentId) return null
    const parent = notes.find(n => n.id === note.parentId)
    if (!parent) return null
    if (parent.noteType === 'tasklist') return parent
    currentId = parent.id
  }
  return null
}

function getAncestorChain(notes: NoteSummary[], noteId: string): NoteSummary[] {
  const chain: NoteSummary[] = []
  let currentId: string | null = noteId

  while (currentId) {
    const note = notes.find(n => n.id === currentId)
    if (!note || !note.parentId) break
    const parent = notes.find(n => n.id === note.parentId)
    if (!parent) break
    chain.unshift(parent)
    currentId = parent.id
  }

  return chain
}

/** Whether an event is the done event of a CREATE_NOTE this window asked for */
const isCreateEnded = (event: NotesEvents): event is CreateEnded => event.type.startsWith('xstate.done.actor.create.')

/** Whether an event says a CREATE_NOTE this window asked for made a note, and carries it */
const isNoteCreated = (event: NotesEvents): boolean =>
  isCreateEnded(event) && event.output.ok && event.output.value.note !== undefined

/** The note a CREATE_NOTE made, for an action wired to the transitions `isNoteCreated` guards */
function created(event: NotesEvents): { note: CreatedNote } {
  if (!isCreateEnded(event) || !event.output.ok || !event.output.value.note) {
    throw new Error(`Expected the done event of a CREATE_NOTE that made a note, got ${event.type}`)
  }
  return { note: event.output.value.note }
}

/** The done event of one of this window's writes, for an action wired to `CREATE_ENDED` or `WRITE_ENDED` */
function ended(event: NotesEvents): CreateEnded | WriteEnded {
  if (!('actorId' in event)) throw new Error(`Expected the done event of a write, got ${event.type}`)
  return event
}

/** A write, asked where the edit is made: recorded in the same assignment under its ask's name, for its end to settle */
const withWrite = (writes: NotesContext['writes'], write: string): { writes: NotesContext['writes'] } =>
  ({ writes: writeSent(writes, write) })

/** `notes` with `note` in it once, whether or not the tree view has brought it already */
const withNote = (notes: NoteSummary[], note: NoteSummary): NoteSummary[] =>
  (notes.some(n => n.id === note.id) ? notes : [...notes, note])

/** The open note and selected task as `notes` now holds them, so the copies follow the tree */
const followed = (context: NotesContext, notes: NoteSummary[]) => ({
  notes,
  currentNote: context.currentNoteId ? notes.find(n => n.id === context.currentNoteId) ?? context.currentNote : null,
  selectedTask: context.selectedTaskId ? notes.find(n => n.id === context.selectedTaskId) ?? context.selectedTask : null,
})

const notesState = setup({
  types: {
    context: {} as NotesContext,
    events: {} as NotesEvents,
  },
  actors: {
    // This window's writes, each asked on its own so each settles when it ends
    createNote: fromAsk('notes', 'CREATE_NOTE'),
    updateNote: fromAsk('notes', 'UPDATE_NOTE'),
    deleteNote: fromAsk('notes', 'DELETE_NOTE'),
    softDeleteNote: fromAsk('notes', 'SOFT_DELETE_NOTE'),
    restoreNote: fromAsk('notes', 'RESTORE_NOTE'),
    moveNote: fromAsk('notes', 'MOVE_NOTE'),
    reorderNote: fromAsk('notes', 'REORDER_NOTE'),
    permanentlyDeleteNote: fromAsk('notes', 'PERMANENTLY_DELETE_NOTE'),
    emptyTrash: fromAsk('notes', 'EMPTY_TRASH'),
  },
  actions: {
    /** The tree as its view read it, which every write — this window's or another's — brings */
    takeTree: assign(({ context, event }) => ({
      ...followed(context, typeOf('NOTES.READ', event).notes),
      writes: viewRead(context.writes).writes,
    })),

    /** An open note's text as its view read it */
    takeNote: assign(({ context, event }) => {
      const { noteId, note } = typeOf('NOTE.READ', event)
      return {
        writes: viewRead(context.writes).writes,
        ...(note && { contents: { ...context.contents, [noteId]: note.content } }),
      }
    }),

    /** A result that may predate a write still unanswered: applying it would undo that edit on screen */
    holdView: assign(({ context }) => ({ writes: viewRead(context.writes).writes })),

    /** One of this window's writes ended: once the last has, the views are read again if a result was held or one was refused */
    settleWrite: enqueueActions(({ context, event, enqueue }) => {
      const { actorId, output } = ended(event)
      enqueue.assign({ writes: writeEnded(context.writes, actorId, !output.ok) })
      enqueue.stopChild(actorId)
    }),

    selectNote: assign(({ event, context }) => {
      const noteId = typeOf(['NOTE.SELECT', 'NOTE.LINK_CLICKED'], event).noteId
      const note = context.notes.find(n => n.id === noteId) || null
      const isHistoryNav = '_historyNav' in event

      // If selecting a note inside a tasklist, open the tasklist with this note selected
      if (note && note.noteType !== 'tasklist') {
        const taskList = findNearestTaskList(context.notes, noteId)
        if (taskList) {
          const ancestorIds = getAncestorChain(context.notes, taskList.id).map(n => n.id)
          const taskAncestors = getAncestorChain(context.notes, noteId)
          const taskListIndex = taskAncestors.findIndex(a => a.id === taskList.id)
          const intermediateIds = taskAncestors.slice(taskListIndex + 1).map(a => a.id)
          return {
            currentNoteId: taskList.id,
            currentNote: taskList,
            viewedNoteId: noteId,
            selectedNoteIds: [],
            selectedTaskId: noteId,
            selectedTask: note,
            expandedNodeIds: [...new Set([...context.expandedNodeIds, ...ancestorIds])],
            taskExpandedNodeIds: [...new Set([...context.taskExpandedNodeIds, ...intermediateIds, taskList.id])],
            ...(!isHistoryNav && { navHistory: pushNavHistory(context.navHistory, taskList.id) }),
          }
        }
      }

      const ancestorIds = getAncestorChain(context.notes, noteId).map(n => n.id)
      return {
        currentNoteId: noteId,
        currentNote: note,
        viewedNoteId: noteId,
        selectedNoteIds: [],
        selectedTaskId: null,
        selectedTask: null,
        expandedNodeIds: [...new Set([...context.expandedNodeIds, ...ancestorIds, noteId])],
        ...(!isHistoryNav && { navHistory: pushNavHistory(context.navHistory, noteId) }),
      }
    }),

    openNote: assign(({ event, context }) => {
      const noteId = event.type === 'OPEN_ENTITY' ? event.id : typeOf('NOTE.OPEN', event).noteId
      const note = context.notes.find(n => n.id === noteId) || null
      const ancestorIds = getAncestorChain(context.notes, noteId).map(n => n.id)
      return {
        currentNoteId: noteId,
        currentNote: note,
        viewedNoteId: noteId,
        selectedNoteIds: [],
        selectedTaskId: null,
        selectedTask: null,
        expandedNodeIds: [...new Set([...context.expandedNodeIds, ...ancestorIds, noteId])],
        navHistory: pushNavHistory(context.navHistory, noteId),
      }
    }),

    sendViewNote: ({ context }) => {
      const noteId = context.viewedNoteId ?? context.currentNoteId
      if (noteId) {
        sendToSystem(id, {
          type: 'VIEW_NOTE',
          id: noteId,
        })
      }
    },

    sendCreateNote: assign(({ context, event, spawn }) => {
      const ev = typeOf('NOTE.CREATE', event)
      return withWrite(context.writes, spawn('createNote', { id: createId(), input: {
        title: ev.title ?? 'Untitled',
        content: ev.content,
        parentId: ev.parentId,
        displayOrder: ev.displayOrder,
      } }).id)
    }),

    sendDeleteNote: assign(({ context, event, spawn }) => {
      const ev = typeOf('NOTE.DELETE', event)
      return withWrite(context.writes, spawn('deleteNote', { id: writeId(), input: {
        id: ev.noteId,
      } }).id)
    }),

    sendSoftDeleteTask: assign(({ context, event, spawn }) => {
      const ev = typeOf('TASK.DELETE', event)
      return withWrite(context.writes, spawn('deleteNote', { id: writeId(), input: {
        id: ev.taskId,
      } }).id)
    }),

    sendSoftDeleteNote: assign(({ context, event, spawn }) => {
      const ev = typeOf('NOTE.SOFT_DELETE', event)
      return withWrite(context.writes, spawn('softDeleteNote', { id: writeId(), input: {
        id: ev.noteId,
      } }).id)
    }),

    sendRestoreNote: assign(({ context, event, spawn }) => {
      const ev = typeOf('NOTE.RESTORE', event)
      return withWrite(context.writes, spawn('restoreNote', { id: writeId(), input: {
        id: ev.noteId,
      } }).id)
    }),

    updateLocalContent: assign(({ context, event }) => {
      const ev = typeOf('NOTE.UPDATE_CONTENT', event)
      return { contents: { ...context.contents, [ev.noteId]: ev.content } }
    }),

    sendUpdateContent: assign(({ context, event, spawn }) => {
      const ev = typeOf('NOTE.UPDATE_CONTENT', event)
      return withWrite(context.writes, spawn('updateNote', { id: writeId(), input: {
        id: ev.noteId,
        content: ev.content,
      } }).id)
    }),

    updateLocalTitle: assign(({ context, event }) => {
      const ev = typeOf('NOTE.UPDATE_TITLE', event)
      const updatedNotes = context.notes.map(n =>
        n.id === ev.noteId ? { ...n, title: ev.title } : n
      )
      return {
        notes: updatedNotes,
        currentNote:
          context.currentNoteId === ev.noteId && context.currentNote
            ? { ...context.currentNote, title: ev.title }
            : context.currentNote,
      }
    }),

    sendUpdateTitle: assign(({ context, event, spawn }) => {
      const ev = typeOf('NOTE.UPDATE_TITLE', event)
      return withWrite(context.writes, spawn('updateNote', { id: writeId(), input: {
        id: ev.noteId,
        title: ev.title,
      } }).id)
    }),

    updateLocalIcon: assign(({ context, event }) => {
      const ev = typeOf('NOTE.UPDATE_ICON', event)
      const updatedNotes = context.notes.map(n =>
        n.id === ev.noteId ? { ...n, icon: ev.icon } : n
      )
      return {
        notes: updatedNotes,
        currentNote:
          context.currentNoteId === ev.noteId && context.currentNote
            ? { ...context.currentNote, icon: ev.icon }
            : context.currentNote,
      }
    }),

    sendUpdateIcon: assign(({ context, event, spawn }) => {
      const ev = typeOf('NOTE.UPDATE_ICON', event)
      return withWrite(context.writes, spawn('updateNote', { id: writeId(), input: {
        id: ev.noteId,
        icon: ev.icon,
      } }).id)
    }),

    toggleFavoriteLocal: assign(({ context, event }) => {
      const ev = typeOf('NOTE.TOGGLE_FAVORITE', event)
      const newFavorite = !context.notes.find(n => n.id === ev.noteId)?.favorite
      const updatedNotes = context.notes.map(n =>
        n.id === ev.noteId ? { ...n, favorite: newFavorite } : n
      )
      return {
        notes: updatedNotes,
        currentNote:
          context.currentNoteId === ev.noteId && context.currentNote
            ? { ...context.currentNote, favorite: newFavorite }
            : context.currentNote,
        selectedTask:
          context.selectedTaskId === ev.noteId && context.selectedTask
            ? { ...context.selectedTask, favorite: newFavorite }
            : context.selectedTask,
      }
    }),

    sendToggleFavorite: assign(({ context, event, spawn }) => {
      const ev = typeOf('NOTE.TOGGLE_FAVORITE', event)
      const note = context.notes.find(n => n.id === ev.noteId)
      if (!note) return {}
      return withWrite(context.writes, spawn('updateNote', { id: writeId(), input: {
        id: ev.noteId,
        favorite: note.favorite,
      } }).id)
    }),

    /** The note this window asked to create, which this window opens; every window's tree has it from its view */
    addCreatedNote: assign(({ context, event }) => {
      const ev = created(event)
      const updatedNotes = withNote(context.notes, ev.note)
      const ancestorIds = getAncestorChain(updatedNotes, ev.note.id).map(n => n.id)
      return {
        notes: updatedNotes,
        createdNoteId: ev.note.id,
        currentNoteId: ev.note.id,
        currentNote: ev.note,
        selectedTaskId: null,
        selectedTask: null,
        expandedNodeIds: [...new Set([...context.expandedNodeIds, ...ancestorIds])],
        navHistory: pushNavHistory(context.navHistory, ev.note.id),
      }
    }),

    handleSubDocumentInsertCreated: assign(({ context, event }) => {
      const ev = created(event)
      // Only handle if there's a pending sub-document insert and the new note has a parent
      if (!context.pendingSubDocumentInsert || !ev.note.parentId) return {}
      const validParentId = context.selectedTaskId ?? context.currentNoteId
      if (ev.note.parentId !== validParentId) return {}

      // Clear pending flag and store the created child's ID so the canvas
      // component can insert the link without guessing by timestamp
      return {
        notes: withNote(context.notes, ev.note),
        pendingSubDocumentInsert: null,
        lastSubDocumentInsertChildId: ev.note.id,
      }
    }),

    toggleExpand: assign(({ context, event }) => {
      const ev = typeOf('NOTE.TOGGLE_EXPAND', event)
      const isExpanded = context.expandedNodeIds.includes(ev.nodeId)
      return {
        expandedNodeIds: isExpanded
          ? context.expandedNodeIds.filter(id => id !== ev.nodeId)
          : [...context.expandedNodeIds, ev.nodeId],
      }
    }),

    toggleExpandTask: assign(({ context, event }) => {
      const ev = typeOf('TASK.TOGGLE_EXPAND', event)
      const isExpanded = context.taskExpandedNodeIds.includes(ev.nodeId)
      return {
        taskExpandedNodeIds: isExpanded
          ? context.taskExpandedNodeIds.filter(id => id !== ev.nodeId)
          : [...context.taskExpandedNodeIds, ev.nodeId],
      }
    }),

    requestSubDocumentInsert: assign(({ event }) => {
      const ev = typeOf('NOTE.REQUEST_DOCUMENT_INSERT', event)
      return {
        pendingSubDocumentInsert: { cursorPos: ev.cursorPos },
      }
    }),

    sendCreateChildForSubDocumentInsert: assign(({ context, event, spawn }) => {
      const ev = typeOf('NOTE.REQUEST_DOCUMENT_INSERT', event)
      return withWrite(context.writes, spawn('createNote', { id: createId(), input: {
        title: 'Untitled',
        parentId: ev.parentId,
        skipContentSync: true,
      } }).id)
    }),

    toggleSelect: assign(({ context, event }) => {
      const ev = typeOf('NOTE.TOGGLE_SELECT', event)
      const ids = context.selectedNoteIds
      const exists = ids.includes(ev.noteId)
      return {
        selectedNoteIds: exists
          ? ids.filter(id => id !== ev.noteId)
          : [...ids, ev.noteId],
      }
    }),

    rangeSelect: assign(({ event }) => {
      const ev = typeOf('NOTE.RANGE_SELECT', event)
      return { selectedNoteIds: ev.noteIds }
    }),

    clearSelection: assign({ selectedNoteIds: [] }),

    sendMoveNotes: assign(({ context, event, spawn }) => {
      const ev = typeOf('NOTE.MOVE', event)
      return withWrite(context.writes, spawn('moveNote', { id: writeId(), input: {
        ids: ev.noteIds,
        newParentId: ev.newParentId,
      } }).id)
    }),

    sendReorderNote: assign(({ context, event, spawn }) => {
      const ev = typeOf('NOTE.REORDER', event)
      return withWrite(context.writes, spawn('reorderNote', { id: writeId(), input: {
        id: ev.noteId,
        newParentId: ev.newParentId,
        newIndex: ev.newIndex,
      } }).id)
    }),

    sendCreateTaskList: assign(({ context, event, spawn }) => {
      const ev = typeOf('NOTE.CREATE_TASKLIST', event)
      return withWrite(context.writes, spawn('createNote', { id: createId(), input: {
        title: 'Untitled',
        noteType: 'tasklist',
        parentId: ev.parentId,
      } }).id)
    }),

    selectTask: assign(({ event, context }) => {
      const ev = typeOf('TASK.SELECT', event)
      const task = context.notes.find(n => n.id === ev.taskId) || null
      return {
        selectedTaskId: ev.taskId,
        selectedTask: task,
      }
    }),

    deselectTask: assign({
      selectedTaskId: null,
      selectedTask: null,
    }),

    sendCreateTask: assign(({ context, event, spawn }) => {
      const ev = typeOf('TASK.CREATE', event)
      return withWrite(context.writes, spawn('createNote', { id: createId(), input: {
        title: 'Untitled',
        parentId: ev.parentId,
        skipContentSync: true,
        noteType: 'task',
      } }).id)
    }),

    sendToggleComplete: assign(({ context, event, spawn }) => {
      const ev = typeOf('TASK.TOGGLE_COMPLETE', event)
      const task = context.notes.find(n => n.id === ev.taskId)
      if (!task) return {}
      return withWrite(context.writes, spawn('updateNote', { id: writeId(), input: {
        id: ev.taskId,
        completed: !task.completed,
      } }).id)
    }),

    sendTaskUpdateContent: assign(({ context, event, spawn }) => {
      const ev = typeOf('TASK.UPDATE_CONTENT', event)
      return withWrite(context.writes, spawn('updateNote', { id: writeId(), input: {
        id: ev.taskId,
        content: ev.content,
      } }).id)
    }),

    updateLocalTaskContent: assign(({ context, event }) => {
      const ev = typeOf('TASK.UPDATE_CONTENT', event)
      return { contents: { ...context.contents, [ev.taskId]: ev.content } }
    }),

    updateLocalTaskTitle: assign(({ context, event }) => {
      const ev = typeOf('TASK.UPDATE_TITLE', event)
      const updatedNotes = context.notes.map(n =>
        n.id === ev.taskId ? { ...n, title: ev.title } : n
      )
      return {
        notes: updatedNotes,
        selectedTask:
          context.selectedTaskId === ev.taskId && context.selectedTask
            ? { ...context.selectedTask, title: ev.title }
            : context.selectedTask,
      }
    }),

    sendTaskUpdateTitle: assign(({ context, event, spawn }) => {
      const ev = typeOf('TASK.UPDATE_TITLE', event)
      return withWrite(context.writes, spawn('updateNote', { id: writeId(), input: {
        id: ev.taskId,
        title: ev.title,
      } }).id)
    }),

    sendDeleteTask: assign(({ context, event, spawn }) => {
      const ev = typeOf('TASK.DELETE', event)
      return withWrite(context.writes, spawn('deleteNote', { id: writeId(), input: {
        id: ev.taskId,
      } }).id)
    }),

    sendToggleShowCompleted: assign(({ context, spawn }) => {
      if (!context.currentNoteId) return {}
      const note = context.notes.find(n => n.id === context.currentNoteId)
      if (!note) return {}
      return withWrite(context.writes, spawn('updateNote', { id: writeId(), input: {
        id: context.currentNoteId,
        hideCompletedChildren: !note.hideCompletedChildren,
      } }).id)
    }),

    sendToggleHideCompletedChildren: assign(({ context, event, spawn }) => {
      const ev = typeOf('TASK.TOGGLE_HIDE_COMPLETED_CHILDREN', event)
      const note = context.notes.find(n => n.id === ev.nodeId)
      if (!note) return {}
      return withWrite(context.writes, spawn('updateNote', { id: writeId(), input: {
        id: ev.nodeId,
        hideCompletedChildren: !note.hideCompletedChildren,
      } }).id)
    }),

    clearCurrentNote: assign(({ context }) => ({
      currentNoteId: null,
      currentNote: null,
      navHistory: pushNavHistory(context.navHistory, null),
    })),

    showTrash: assign({ showTrash: true }),

    hideTrash: assign({ showTrash: false }),

    sendPermanentlyDelete: assign(({ context, event, spawn }) => {
      const ev = typeOf('NOTE.PERMANENTLY_DELETE', event)
      return withWrite(context.writes, spawn('permanentlyDeleteNote', { id: writeId(), input: {
        id: ev.noteId,
      } }).id)
    }),

    sendEmptyTrash: assign(({ context, spawn }) => {
      return withWrite(context.writes, spawn('emptyTrash', { id: writeId(), input: {} }).id)
    }),

    saveScroll: assign(({ context, event }) => {
      const ev = typeOf('NOTE.SAVE_SCROLL', event)
      return {
        noteScrollPositions: { ...context.noteScrollPositions, [ev.noteId]: ev.scrollTop },
      }
    }),

    togglePanelSearch: assign(({ context }) => ({
      panelSearchActive: !context.panelSearchActive,
    })),
  },
  guards: { entityIs: entityIs<Contract['opens']>, targetIs,
    /** Whether any of this window's writes is unanswered */
    writing: ({ context }) => writing(context.writes),
    /** Whether a tree read leaves out the note open in the editor */
    losesCurrentNote: ({ context, event }) => event.type === 'NOTES.READ' && context.currentNoteId !== null
      && !event.notes.some(n => n.id === context.currentNoteId),
  },
}).createMachine({
  id,
  initial: 'welcome',
  context: {
    notes: [],
    contents: {},
    writes: viewWrites(),
    createdNoteId: null,
    currentNoteId: null,
    currentNote: null,
    expandedNodeIds: [],
    taskExpandedNodeIds: [],
    pendingSubDocumentInsert: null,
    lastSubDocumentInsertChildId: null,
    selectedNoteIds: [],
    selectedTaskId: null,
    selectedTask: null,
    showTrash: false,
    noteScrollPositions: {},
    panelSearchActive: false,
    navHistory: createNavHistory<string | null>(null),
    viewedNoteId: null,
  },
  on: {
    OPEN_ENTITY: { guard: { type: 'entityIs', params: { entity: 'Note' } }, target: '.editor', actions: ['openNote', 'sendViewNote'] },
    'NOTES.READ': [
      { guard: 'writing', actions: 'holdView' },
      // The open note is gone — deleted here or in another window
      { guard: 'losesCurrentNote', target: '.welcome', actions: ['takeTree', 'clearCurrentNote'] },
      { actions: 'takeTree' },
    ],
    'NOTE.READ': [
      { guard: 'writing', actions: 'holdView' },
      { actions: 'takeNote' },
    ],
    // A write that ended settles; a refused one reads the notes as stored again
    [CREATE_ENDED]: { actions: 'settleWrite' },
    [WRITE_ENDED]: { actions: 'settleWrite' },
    'NOTE.SOFT_DELETE': { actions: 'sendSoftDeleteNote' },
    'NOTE.RESTORE': { actions: 'sendRestoreNote' },
    'NOTE.TOGGLE_EXPAND': { actions: 'toggleExpand' },
    'TASK.TOGGLE_EXPAND': { actions: 'toggleExpandTask' },
    'NOTE.TOGGLE_SELECT': { actions: 'toggleSelect' },
    'NOTE.RANGE_SELECT': { actions: 'rangeSelect' },
    'NOTE.CLEAR_SELECTION': { actions: 'clearSelection' },
    'NOTE.MOVE': { actions: ['sendMoveNotes', 'clearSelection'] },
    'NOTE.REORDER': { actions: ['sendReorderNote', 'clearSelection'] },
    'NOTE.UPDATE_CONTENT': { actions: ['updateLocalContent', 'sendUpdateContent'] },
    'NOTE.UPDATE_TITLE': { actions: ['updateLocalTitle', 'sendUpdateTitle'] },
    'NOTE.UPDATE_ICON': { actions: ['updateLocalIcon', 'sendUpdateIcon'] },
    'NOTE.TOGGLE_FAVORITE': { actions: ['toggleFavoriteLocal', 'sendToggleFavorite'] },
    'TASK.SELECT': { actions: 'selectTask' },
    'TASK.DESELECT': { actions: 'deselectTask' },
    'TASK.TOGGLE_COMPLETE': { actions: 'sendToggleComplete' },
    'TASK.UPDATE_CONTENT': { actions: ['updateLocalTaskContent', 'sendTaskUpdateContent'] },
    'TASK.UPDATE_TITLE': { actions: ['updateLocalTaskTitle', 'sendTaskUpdateTitle'] },
    'TASK.DELETE': { actions: 'sendSoftDeleteTask' },
    'TASK.TOGGLE_SHOW_COMPLETED': { actions: 'sendToggleShowCompleted' },
    'TASK.TOGGLE_HIDE_COMPLETED_CHILDREN': { actions: 'sendToggleHideCompletedChildren' },
    'NOTE.SHOW_TRASH': { actions: 'showTrash' },
    'NOTE.HIDE_TRASH': { actions: 'hideTrash' },
    'NOTE.PERMANENTLY_DELETE': { actions: 'sendPermanentlyDelete' },
    'NOTE.EMPTY_TRASH': { actions: 'sendEmptyTrash' },
    'NOTE.SAVE_SCROLL': { actions: 'saveScroll' },
    'NOTE.TOGGLE_PANEL_SEARCH': { actions: 'togglePanelSearch' },
    NAVIGATE_BACK: [
      {
        guard: ({ context }) => {
          if (!canGoBack(context.navHistory)) return false;
          return context.navHistory.stack[context.navHistory.index - 1] === null;
        },
        target: '.welcome',
        actions: assign(({ context }) => {
          const result = goBack(context.navHistory)!;
          return { navHistory: result.history, currentNoteId: null, currentNote: null };
        }),
      },
      {
        guard: ({ context }) => {
          if (!canGoBack(context.navHistory)) return false;
          const target = context.navHistory.stack[context.navHistory.index - 1];
          return target !== null && context.notes.some(n => n.id === target);
        },
        target: '.editor',
        actions: assign(({ context }) => {
          const result = goBack(context.navHistory)!;
          const note = context.notes.find(n => n.id === result.entry) || null;
          return {
            navHistory: result.history,
            currentNoteId: result.entry,
            currentNote: note,
            selectedTaskId: null,
            selectedTask: null,
          };
        }),
      },
    ],
    NAVIGATE_FORWARD: [
      {
        guard: ({ context }) => {
          if (!canGoForward(context.navHistory)) return false;
          return context.navHistory.stack[context.navHistory.index + 1] === null;
        },
        target: '.welcome',
        actions: assign(({ context }) => {
          const result = goForward(context.navHistory)!;
          return { navHistory: result.history, currentNoteId: null, currentNote: null };
        }),
      },
      {
        guard: ({ context }) => {
          if (!canGoForward(context.navHistory)) return false;
          const target = context.navHistory.stack[context.navHistory.index + 1];
          return target !== null && context.notes.some(n => n.id === target);
        },
        target: '.editor',
        actions: assign(({ context }) => {
          const result = goForward(context.navHistory)!;
          const note = context.notes.find(n => n.id === result.entry) || null;
          return {
            navHistory: result.history,
            currentNoteId: result.entry,
            currentNote: note,
            selectedTaskId: null,
            selectedTask: null,
          };
        }),
      },
    ],
    TRAIL_CLICK: [
      {
        guard: { type: 'targetIs', params: { view: 'welcome' } },
        target: '.welcome',
        actions: 'clearCurrentNote',
      },
      {
        guard: { type: 'targetIs', params: { view: 'editor' } },
        target: '.editor',
        actions: [
          assign(({ event, context }) => {
            const noteId = typeOf('TRAIL_CLICK', event).info
            if (!noteId) return {}
            const note = context.notes.find(n => n.id === noteId) || null

            // If clicking a task segment, navigate to its parent tasklist and select the task
            if (note?.noteType === 'task') {
              const taskList = findNearestTaskList(context.notes, noteId)
              if (taskList) {
                return {
                  currentNoteId: taskList.id,
                  currentNote: taskList,
                  viewedNoteId: noteId,
                  selectedTaskId: noteId,
                  selectedTask: note,
                  navHistory: pushNavHistory(context.navHistory, taskList.id),
                }
              }
            }

            // Regular note or tasklist — navigate directly, clear task selection
            return {
              currentNoteId: noteId,
              currentNote: note,
              viewedNoteId: noteId,
              selectedTaskId: null,
              selectedTask: null,
              navHistory: pushNavHistory(context.navHistory, noteId),
            }
          }),
          'sendViewNote',
        ],
      },
    ],
  },
  states: {
    welcome: {
      tags: ['welcome'],
      meta: { ...breadcrumb('welcome', 'Notes', true) },
      on: {
        'NOTE.CREATE': {
          actions: 'sendCreateNote',
        },
        'NOTE.CREATE_TASKLIST': {
          actions: 'sendCreateTaskList',
        },
        'TASK.CREATE': {
          actions: 'sendCreateTask',
        },
        // The note a CREATE_NOTE this window asked for made
        [CREATE_ENDED]: [
          {
            guard: ({ event, context }) => {
              if (!isNoteCreated(event)) return false
              const ev = created(event)
              const updatedNotes = withNote(context.notes, ev.note)
              return findNearestTaskList(updatedNotes, ev.note.id) !== null
            },
            actions: [
              assign(({ context, event }) => {
                const ev = created(event)
                const taskList = findNearestTaskList(withNote(context.notes, ev.note), ev.note.id)
                if (!taskList) return { notes: withNote(context.notes, ev.note) }
                const ancestorIds = getAncestorChain(withNote(context.notes, ev.note), taskList.id).map(n => n.id)
                return {
                  notes: withNote(context.notes, ev.note),
                  currentNoteId: taskList.id,
                  currentNote: taskList,
                  viewedNoteId: ev.note.id,
                  createdNoteId: ev.note.id,
                  selectedTaskId: ev.note.id,
                  selectedTask: ev.note,
                  taskExpandedNodeIds: [...new Set([...context.taskExpandedNodeIds, ...ancestorIds, taskList.id])],
                }
              }),
              'sendViewNote',
              'settleWrite',
            ],
            target: 'editor',
          },
          {
            guard: ({ event }) => isNoteCreated(event),
            actions: ['addCreatedNote', 'settleWrite'],
            target: 'editor',
          },
        ],
        'NOTE.SELECT': {
          actions: ['selectNote', 'sendViewNote'],
          target: 'editor',
        },
        'NOTE.OPEN': {
          actions: ['openNote', 'sendViewNote'],
          target: 'editor',
        },
        'NOTE.DELETE': {
          actions: 'sendDeleteNote',
        },
      },
    },
    editor: {
      tags: ['editor'],
      meta: {
        ...breadcrumbList<NotesContext>((ctx) => {
          if (!ctx.currentNoteId || !ctx.currentNote) {
            return []
          }
          const ancestors = getAncestorChain(ctx.notes, ctx.currentNoteId)
          const crumbs = [
            ...ancestors.map(a => ({ label: (a.icon ? a.icon + ' ' : '') + a.title, target: 'editor', info: a.id })),
            { label: (ctx.currentNote.icon ? ctx.currentNote.icon + ' ' : '') + ctx.currentNote.title, target: 'editor', info: ctx.currentNoteId },
          ]
          if (ctx.selectedTask) {
            // Build full path from tasklist to selected task (including intermediate parent tasks)
            const taskAncestors = getAncestorChain(ctx.notes, ctx.selectedTask.id)
            const taskListIndex = taskAncestors.findIndex(a => a.id === ctx.currentNoteId)
            const intermediates = taskAncestors.slice(taskListIndex + 1)
            for (const t of intermediates) {
              crumbs.push({ label: (t.icon ? t.icon + ' ' : '') + t.title, target: 'editor', info: t.id })
            }
            crumbs.push({
              label: (ctx.selectedTask.icon ? ctx.selectedTask.icon + ' ' : '') + ctx.selectedTask.title,
              target: 'editor',
              info: ctx.selectedTask.id,
            })
          }
          return crumbs
        }),
        ...contextMenuFn<NotesContext>((ctx) => {
          const deleteId = ctx.selectedTaskId ?? ctx.currentNoteId
          if (!deleteId) return []
          const deleteTitle = (ctx.selectedTask ?? ctx.currentNote)?.title || 'this note'
          return [
            {
              label: 'Delete Note',
              icon: Trash2,
              iconColor: 'text-red-400',
              event: { type: 'NOTE.DELETE' as const, noteId: deleteId },
              confirm: `Are you sure you want to delete "${deleteTitle}"?`,
            },
          ]
        }),
      },
      on: {
        'NOTE.SELECT': {
          actions: ['selectNote', 'sendViewNote'],
        },
        'NOTE.OPEN': {
          actions: ['openNote', 'sendViewNote'],
        },
        'NOTE.CREATE': {
          actions: 'sendCreateNote',
        },
        'NOTE.CREATE_TASKLIST': {
          actions: 'sendCreateTaskList',
        },
        'TASK.CREATE': {
          actions: 'sendCreateTask',
        },
        // The note a CREATE_NOTE this window asked for made
        [CREATE_ENDED]: [
          {
            guard: ({ context, event }) => isNoteCreated(event) && context.pendingSubDocumentInsert !== null,
            actions: ['handleSubDocumentInsertCreated', 'settleWrite'],
          },
          {
            // If the new note's parent is the current tasklist, add to list but don't navigate
            guard: ({ context, event }) => {
              if (!isNoteCreated(event)) return false
              const ev = created(event)
              const updatedNotes = withNote(context.notes, ev.note)
              return context.currentNote?.noteType === 'tasklist'
                && findNearestTaskList(updatedNotes, ev.note.id)?.id === context.currentNoteId
            },
            actions: [assign(({ context, event }) => {
              const ev = created(event)
              const updatedNotes = withNote(context.notes, ev.note)
              const taskAncestors = getAncestorChain(updatedNotes, ev.note.id)
              const taskListIndex = taskAncestors.findIndex(a => a.id === context.currentNoteId)
              const intermediateIds = taskAncestors.slice(taskListIndex + 1).map(a => a.id)
              return {
                notes: updatedNotes,
                createdNoteId: ev.note.id,
                selectedTaskId: ev.note.id,
                selectedTask: ev.note,
                taskExpandedNodeIds: [...new Set([...context.taskExpandedNodeIds, ...intermediateIds, ...(context.currentNoteId ? [context.currentNoteId] : [])])],
              }
            }), 'settleWrite'],
          },
          {
            // Note created for a tasklist that isn't currently viewed — navigate to it
            guard: ({ context, event }) => {
              if (!isNoteCreated(event)) return false
              const ev = created(event)
              const updatedNotes = withNote(context.notes, ev.note)
              return findNearestTaskList(updatedNotes, ev.note.id) !== null
            },
            actions: [
              assign(({ context, event }) => {
                const ev = created(event)
                const updatedNotes = withNote(context.notes, ev.note)
                const taskList = findNearestTaskList(updatedNotes, ev.note.id)
                if (!taskList) return { notes: updatedNotes }
                const ancestorIds = getAncestorChain(updatedNotes, taskList.id).map(n => n.id)
                const taskAncestors = getAncestorChain(updatedNotes, ev.note.id)
                const taskListIndex = taskAncestors.findIndex(a => a.id === taskList.id)
                const intermediateIds = taskAncestors.slice(taskListIndex + 1).map(a => a.id)
                return {
                  notes: updatedNotes,
                  currentNoteId: taskList.id,
                  currentNote: taskList,
                  viewedNoteId: ev.note.id,
                  createdNoteId: ev.note.id,
                  selectedTaskId: ev.note.id,
                  selectedTask: ev.note,
                  taskExpandedNodeIds: [...new Set([...context.taskExpandedNodeIds, ...ancestorIds, ...intermediateIds, taskList.id])],
                }
              }),
              'sendViewNote',
              'settleWrite',
            ],
          },
          {
            guard: ({ event }) => isNoteCreated(event),
            actions: ['addCreatedNote', 'settleWrite'],
          },
        ],
        'NOTE.DELETE': {
          actions: 'sendDeleteNote',
        },
        'NOTE.LINK_CLICKED': {
          actions: ['selectNote', 'sendViewNote'],
        },
        'NOTE.REQUEST_DOCUMENT_INSERT': {
          actions: ['requestSubDocumentInsert', 'sendCreateChildForSubDocumentInsert'],
        },
        'VIEW_WELCOME': {
          actions: 'clearCurrentNote',
          target: 'welcome',
        },
      },
    },
  },
})

export default notesState
