import type { OutcomeOf, Read, Value } from '@apackdev/state';
import type { OpenEntity } from '@apackdev/sdk/events';
import {
  canGoBack,
  canGoForward,
  createNavHistory,
  entityIs,
  freshKey,
  goBack,
  goForward,
  pushNavHistory,
  viewRead,
  viewWrites,
  writeEnded,
  writeSent,
  writing,
  type NavHistory,
  type SurfaceChrome,
  type TrailClickEvent,
  type ViewWrites,
} from '@apackdev/sdk/fe';
import { Trash2 } from 'lucide-vue-next';
import { state, type PackNet } from '#generated/state.ts';
import type { NoteDTO, NoteSummary } from '#generated/types.ts';
import type { Contract, NotesContext, NotesInboxEvent } from './contract.ts';

export const id = 'notes' as const;

type NotesAsks = PackNet['systems']['notes']['asks'];

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
  /** The settings form's import and export, and the result of each no longer shown */
  | { type: 'NOTES.IMPORT'; directory: string }
  | { type: 'NOTES.FORGET_IMPORT' }
  | { type: 'NOTES.EXPORT'; directory: string; format: 'markdown' | 'json' }
  | { type: 'NOTES.FORGET_EXPORT' };

export type NotesEvents = OpenEntity | UIEvent | TrailClickEvent<string>;

type NotesData = NotesContext & {
  /** How the last import ended, until another folder is picked */
  imported: OutcomeOf<NotesAsks['IMPORT_NOTES']> | undefined;
  /** How the last export ended, until another is made */
  exported: OutcomeOf<NotesAsks['EXPORT_NOTES']> | undefined;
};

type NotesShape = {
  data: NotesData;
  calls: {
    createNote: { readonly each: NotesAsks['CREATE_NOTE']['args'] };
    updateNote: { readonly each: NotesAsks['UPDATE_NOTE']['args'] };
    deleteNote: { readonly each: NotesAsks['DELETE_NOTE']['args'] };
    softDeleteNote: { readonly each: NotesAsks['SOFT_DELETE_NOTE']['args'] };
    restoreNote: { readonly each: NotesAsks['RESTORE_NOTE']['args'] };
    moveNote: { readonly each: NotesAsks['MOVE_NOTE']['args'] };
    reorderNote: { readonly each: NotesAsks['REORDER_NOTE']['args'] };
    permanentlyDeleteNote: { readonly each: NotesAsks['PERMANENTLY_DELETE_NOTE']['args'] };
    emptyTrash: 'each';
    importNotes: { readonly one: NotesAsks['IMPORT_NOTES']['args'] };
    exportNotes: { readonly one: NotesAsks['EXPORT_NOTES']['args'] };
  };
  states: {
    welcome: {};
    editor: {};
  };
};

function findNearestTaskList(notes: readonly Read<NoteSummary>[], noteId: string): NoteSummary | null {
  let currentId: string | null = noteId;
  while (currentId) {
    const note = notes.find(n => n.id === currentId);
    if (!note || !note.parentId) return null;
    const parent = notes.find(n => n.id === note.parentId);
    if (!parent) return null;
    if (parent.noteType === 'tasklist') return parent;
    currentId = parent.id;
  }
  return null;
}

function getAncestorChain(notes: readonly Read<NoteSummary>[], noteId: string): NoteSummary[] {
  const chain: NoteSummary[] = [];
  let currentId: string | null = noteId;

  while (currentId) {
    const note = notes.find(n => n.id === currentId);
    if (!note || !note.parentId) break;
    const parent = notes.find(n => n.id === note.parentId);
    if (!parent) break;
    chain.unshift(parent);
    currentId = parent.id;
  }

  return chain;
}

/** `notes` with `note` in it once, whether or not the tree view has brought it already */
const withNote = (notes: readonly Read<NoteSummary>[], note: NoteSummary): NoteSummary[] =>
  (notes.some(n => n.id === note.id) ? [...notes] : [...notes, note]);

/** The open note and selected task as `notes` now holds them, so the copies follow the tree */
const followed = (data: Read<NotesData>, notes: NoteSummary[]) => ({
  notes,
  currentNote: data.currentNoteId ? notes.find(n => n.id === data.currentNoteId) ?? data.currentNote : null,
  selectedTask: data.selectedTaskId ? notes.find(n => n.id === data.selectedTaskId) ?? data.selectedTask : null,
});

function selectNoteData(data: Read<NotesData>, noteId: string, isHistoryNav = false): Partial<NotesData> {
  const note = data.notes.find(n => n.id === noteId) || null;
  const nav = data.navHistory as NavHistory<string | null>;

  // If selecting a note inside a tasklist, open the tasklist with this note selected
  if (note && note.noteType !== 'tasklist') {
    const taskList = findNearestTaskList(data.notes, noteId);
    if (taskList) {
      const ancestorIds = getAncestorChain(data.notes, taskList.id).map(n => n.id);
      const taskAncestors = getAncestorChain(data.notes, noteId);
      const taskListIndex = taskAncestors.findIndex(a => a.id === taskList.id);
      const intermediateIds = taskAncestors.slice(taskListIndex + 1).map(a => a.id);
      return {
        currentNoteId: taskList.id,
        currentNote: taskList,
        viewedNoteId: noteId,
        selectedNoteIds: [],
        selectedTaskId: noteId,
        selectedTask: note,
        expandedNodeIds: [...new Set([...data.expandedNodeIds, ...ancestorIds])],
        taskExpandedNodeIds: [...new Set([...data.taskExpandedNodeIds, ...intermediateIds, taskList.id])],
        ...(!isHistoryNav ? { navHistory: pushNavHistory(nav, taskList.id) } : {}),
      };
    }
  }

  const ancestorIds = getAncestorChain(data.notes, noteId).map(n => n.id);
  return {
    currentNoteId: noteId,
    currentNote: note,
    viewedNoteId: noteId,
    selectedNoteIds: [],
    selectedTaskId: null,
    selectedTask: null,
    expandedNodeIds: [...new Set([...data.expandedNodeIds, ...ancestorIds, noteId])],
    ...(!isHistoryNav ? { navHistory: pushNavHistory(nav, noteId) } : {}),
  };
}

function openNoteData(data: Read<NotesData>, noteId: string): Partial<NotesData> {
  const note = data.notes.find(n => n.id === noteId) || null;
  const ancestorIds = getAncestorChain(data.notes, noteId).map(n => n.id);
  return {
    currentNoteId: noteId,
    currentNote: note,
    viewedNoteId: noteId,
    selectedNoteIds: [],
    selectedTaskId: null,
    selectedTask: null,
    expandedNodeIds: [...new Set([...data.expandedNodeIds, ...ancestorIds, noteId])],
    navHistory: pushNavHistory(data.navHistory as NavHistory<string | null>, noteId),
  };
}

export const notesChrome: SurfaceChrome<Value<NotesShape>> = {
  default: { label: 'Notes', target: 'welcome' },
  states: {
    welcome: {
      breadcrumb: { label: 'Notes', target: 'welcome' },
    },
    editor: {
      breadcrumb: ({ data }) => {
        if (!data.currentNoteId || !data.currentNote) return [];
        const ancestors = getAncestorChain(data.notes, data.currentNoteId);
        const crumbs = [
          ...ancestors.map(a => ({ label: (a.icon ? a.icon + ' ' : '') + a.title, target: 'editor', info: a.id })),
          { label: (data.currentNote.icon ? data.currentNote.icon + ' ' : '') + data.currentNote.title, target: 'editor', info: data.currentNoteId },
        ];
        if (data.selectedTask) {
          // Build full path from tasklist to selected task (including intermediate parent tasks)
          const taskAncestors = getAncestorChain(data.notes, data.selectedTask.id);
          const taskListIndex = taskAncestors.findIndex(a => a.id === data.currentNoteId);
          const intermediates = taskAncestors.slice(taskListIndex + 1);
          for (const t of intermediates) {
            crumbs.push({ label: (t.icon ? t.icon + ' ' : '') + t.title, target: 'editor', info: t.id });
          }
          crumbs.push({
            label: (data.selectedTask.icon ? data.selectedTask.icon + ' ' : '') + data.selectedTask.title,
            target: 'editor',
            info: data.selectedTask.id,
          });
        }
        return crumbs;
      },
      menu: ({ data }) => {
        const deleteId = data.selectedTaskId ?? data.currentNoteId;
        if (!deleteId) return [];
        const deleteTitle = (data.selectedTask ?? data.currentNote)?.title || 'this note';
        return [
          {
            label: 'Delete Note',
            icon: Trash2,
            iconColor: 'text-red-400',
            event: { type: 'NOTE.DELETE' as const, noteId: deleteId },
            confirm: `Are you sure you want to delete "${deleteTitle}"?`,
          },
        ];
      },
    },
  },
};

const notesState = state<NotesShape, NotesEvents>()({
  initial: 'welcome',
  data: {
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
    imported: undefined,
    exported: undefined,
  },
  calls: ({ one, each }) => ({
    createNote: each('notes', 'CREATE_NOTE', {
      args: (_key, input) => input,
      done: (outcome, { key, data, snapshot, tell }) => {
        const writes = writeEnded(data.writes as ViewWrites, key, !outcome.ok);
        if (!outcome.ok || !outcome.value.note) return { data: { writes } };
        const note = outcome.value.note;
        const updatedNotes = withNote(data.notes, note);

        if (snapshot.at === 'welcome') {
          const taskList = findNearestTaskList(updatedNotes, note.id);
          if (taskList) {
            const ancestorIds = getAncestorChain(updatedNotes, taskList.id).map(n => n.id);
            tell(id, { type: 'VIEW_NOTE', id: note.id });
            return {
              at: 'editor',
              data: {
                writes,
                notes: updatedNotes,
                currentNoteId: taskList.id,
                currentNote: taskList,
                viewedNoteId: note.id,
                createdNoteId: note.id,
                selectedTaskId: note.id,
                selectedTask: note,
                taskExpandedNodeIds: [...new Set([...data.taskExpandedNodeIds, ...ancestorIds, taskList.id])],
              },
            };
          }
          const ancestorIds = getAncestorChain(updatedNotes, note.id).map(n => n.id);
          return {
            at: 'editor',
            data: {
              writes,
              notes: updatedNotes,
              createdNoteId: note.id,
              currentNoteId: note.id,
              currentNote: note,
              selectedTaskId: null,
              selectedTask: null,
              expandedNodeIds: [...new Set([...data.expandedNodeIds, ...ancestorIds])],
              navHistory: pushNavHistory(data.navHistory as NavHistory<string | null>, note.id),
            },
          };
        }

        // In editor state
        if (data.pendingSubDocumentInsert !== null) {
          const validParentId = data.selectedTaskId ?? data.currentNoteId;
          if (!note.parentId || note.parentId !== validParentId) return { data: { writes } };
          return {
            data: {
              writes,
              notes: updatedNotes,
              pendingSubDocumentInsert: null,
              lastSubDocumentInsertChildId: note.id,
            },
          };
        }

        // If the new note's parent is the current tasklist, add to list but don't navigate
        const nearestTaskList = findNearestTaskList(updatedNotes, note.id);
        if (data.currentNote?.noteType === 'tasklist' && nearestTaskList?.id === data.currentNoteId) {
          const taskAncestors = getAncestorChain(updatedNotes, note.id);
          const taskListIndex = taskAncestors.findIndex(a => a.id === data.currentNoteId);
          const intermediateIds = taskAncestors.slice(taskListIndex + 1).map(a => a.id);
          return {
            data: {
              writes,
              notes: updatedNotes,
              createdNoteId: note.id,
              selectedTaskId: note.id,
              selectedTask: note,
              taskExpandedNodeIds: [...new Set([...data.taskExpandedNodeIds, ...intermediateIds, ...(data.currentNoteId ? [data.currentNoteId] : [])])],
            },
          };
        }

        // Note created for a tasklist that isn't currently viewed — navigate to it
        if (nearestTaskList) {
          const ancestorIds = getAncestorChain(updatedNotes, nearestTaskList.id).map(n => n.id);
          const taskAncestors = getAncestorChain(updatedNotes, note.id);
          const taskListIndex = taskAncestors.findIndex(a => a.id === nearestTaskList.id);
          const intermediateIds = taskAncestors.slice(taskListIndex + 1).map(a => a.id);
          tell(id, { type: 'VIEW_NOTE', id: note.id });
          return {
            data: {
              writes,
              notes: updatedNotes,
              currentNoteId: nearestTaskList.id,
              currentNote: nearestTaskList,
              viewedNoteId: note.id,
              createdNoteId: note.id,
              selectedTaskId: note.id,
              selectedTask: note,
              taskExpandedNodeIds: [...new Set([...data.taskExpandedNodeIds, ...ancestorIds, ...intermediateIds, nearestTaskList.id])],
            },
          };
        }

        const ancestorIds = getAncestorChain(updatedNotes, note.id).map(n => n.id);
        return {
          data: {
            writes,
            notes: updatedNotes,
            createdNoteId: note.id,
            currentNoteId: note.id,
            currentNote: note,
            selectedTaskId: null,
            selectedTask: null,
            expandedNodeIds: [...new Set([...data.expandedNodeIds, ...ancestorIds])],
            navHistory: pushNavHistory(data.navHistory as NavHistory<string | null>, note.id),
          },
        };
      },
    }),
    updateNote: each('notes', 'UPDATE_NOTE', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: { writes: writeEnded(data.writes as ViewWrites, key, !outcome.ok) } }),
    }),
    deleteNote: each('notes', 'DELETE_NOTE', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: { writes: writeEnded(data.writes as ViewWrites, key, !outcome.ok) } }),
    }),
    softDeleteNote: each('notes', 'SOFT_DELETE_NOTE', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: { writes: writeEnded(data.writes as ViewWrites, key, !outcome.ok) } }),
    }),
    restoreNote: each('notes', 'RESTORE_NOTE', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: { writes: writeEnded(data.writes as ViewWrites, key, !outcome.ok) } }),
    }),
    moveNote: each('notes', 'MOVE_NOTE', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: { writes: writeEnded(data.writes as ViewWrites, key, !outcome.ok) } }),
    }),
    reorderNote: each('notes', 'REORDER_NOTE', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: { writes: writeEnded(data.writes as ViewWrites, key, !outcome.ok) } }),
    }),
    permanentlyDeleteNote: each('notes', 'PERMANENTLY_DELETE_NOTE', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: { writes: writeEnded(data.writes as ViewWrites, key, !outcome.ok) } }),
    }),
    emptyTrash: each('notes', 'EMPTY_TRASH', {
      done: (outcome, { key, data }) => ({ data: { writes: writeEnded(data.writes as ViewWrites, key, !outcome.ok) } }),
    }),
    importNotes: one('notes', 'IMPORT_NOTES', {
      done: (outcome) => ({ data: { imported: outcome } }),
    }),
    exportNotes: one('notes', 'EXPORT_NOTES', {
      done: (outcome) => ({ data: { exported: outcome } }),
    }),
  }),
  on: {
    OPEN_ENTITY: (event, { data, tell }) => {
      if (!entityIs<Contract['opens']>({ event }, { entity: 'Note' })) return;
      tell(id, { type: 'VIEW_NOTE', id: event.id });
      return { at: 'editor', data: openNoteData(data, event.id) };
    },
    'NOTES.READ': (event, { data }) => {
      if (writing(data.writes as ViewWrites)) {
        return { data: { writes: viewRead(data.writes as ViewWrites).writes } };
      }
      const nextWrites = viewRead(data.writes as ViewWrites).writes;
      // The open note is gone — deleted here or in another window
      if (data.currentNoteId !== null && !event.notes.some(n => n.id === data.currentNoteId)) {
        return {
          at: 'welcome',
          data: {
            ...followed(data, event.notes),
            writes: nextWrites,
            currentNoteId: null,
            currentNote: null,
            navHistory: pushNavHistory(data.navHistory as NavHistory<string | null>, null),
          },
        };
      }
      return {
        data: {
          ...followed(data, event.notes),
          writes: nextWrites,
        },
      };
    },
    'NOTE.READ': (event, { data }) => {
      if (writing(data.writes as ViewWrites)) {
        return { data: { writes: viewRead(data.writes as ViewWrites).writes } };
      }
      return {
        data: {
          writes: viewRead(data.writes as ViewWrites).writes,
          ...(event.note ? { contents: { ...data.contents, [event.noteId]: event.note.content } } : {}),
        },
      };
    },
    // The settings form's import and export
    'NOTES.IMPORT': (event, { call, cancel }) => {
      cancel('importNotes');
      call('importNotes', { directory: event.directory });
      return { data: { imported: undefined } };
    },
    'NOTES.FORGET_IMPORT': () => ({ data: { imported: undefined } }),
    'NOTES.EXPORT': (event, { call, cancel }) => {
      cancel('exportNotes');
      call('exportNotes', { directory: event.directory, format: event.format });
      return { data: { exported: undefined } };
    },
    'NOTES.FORGET_EXPORT': () => ({ data: { exported: undefined } }),
    'NOTE.SOFT_DELETE': (event, { data, call }) => {
      const key = freshKey();
      call('softDeleteNote', key, { id: event.noteId });
      return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
    },
    'NOTE.RESTORE': (event, { data, call }) => {
      const key = freshKey();
      call('restoreNote', key, { id: event.noteId });
      return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
    },
    'NOTE.TOGGLE_EXPAND': (event, { data }) => {
      const isExpanded = data.expandedNodeIds.includes(event.nodeId);
      return {
        data: {
          expandedNodeIds: isExpanded
            ? data.expandedNodeIds.filter(each => each !== event.nodeId)
            : [...data.expandedNodeIds, event.nodeId],
        },
      };
    },
    'TASK.TOGGLE_EXPAND': (event, { data }) => {
      const isExpanded = data.taskExpandedNodeIds.includes(event.nodeId);
      return {
        data: {
          taskExpandedNodeIds: isExpanded
            ? data.taskExpandedNodeIds.filter(each => each !== event.nodeId)
            : [...data.taskExpandedNodeIds, event.nodeId],
        },
      };
    },
    'NOTE.TOGGLE_SELECT': (event, { data }) => {
      const exists = data.selectedNoteIds.includes(event.noteId);
      return {
        data: {
          selectedNoteIds: exists
            ? data.selectedNoteIds.filter(each => each !== event.noteId)
            : [...data.selectedNoteIds, event.noteId],
        },
      };
    },
    'NOTE.RANGE_SELECT': (event) => ({ data: { selectedNoteIds: event.noteIds } }),
    'NOTE.CLEAR_SELECTION': () => ({ data: { selectedNoteIds: [] } }),
    'NOTE.MOVE': (event, { data, call }) => {
      const key = freshKey();
      call('moveNote', key, { ids: event.noteIds, newParentId: event.newParentId });
      return { data: { writes: writeSent(data.writes as ViewWrites, key), selectedNoteIds: [] } };
    },
    'NOTE.REORDER': (event, { data, call }) => {
      const key = freshKey();
      call('reorderNote', key, { id: event.noteId, newParentId: event.newParentId, newIndex: event.newIndex });
      return { data: { writes: writeSent(data.writes as ViewWrites, key), selectedNoteIds: [] } };
    },
    'NOTE.UPDATE_CONTENT': (event, { data, call }) => {
      const key = freshKey();
      call('updateNote', key, { id: event.noteId, content: event.content });
      return {
        data: {
          contents: { ...data.contents, [event.noteId]: event.content },
          writes: writeSent(data.writes as ViewWrites, key),
        },
      };
    },
    'NOTE.UPDATE_TITLE': (event, { data, call }) => {
      const key = freshKey();
      call('updateNote', key, { id: event.noteId, title: event.title });
      return {
        data: {
          notes: data.notes.map(n => (n.id === event.noteId ? { ...n, title: event.title } : n)),
          currentNote: data.currentNoteId === event.noteId && data.currentNote
            ? { ...data.currentNote, title: event.title }
            : data.currentNote,
          writes: writeSent(data.writes as ViewWrites, key),
        },
      };
    },
    'NOTE.UPDATE_ICON': (event, { data, call }) => {
      const key = freshKey();
      call('updateNote', key, { id: event.noteId, icon: event.icon });
      return {
        data: {
          notes: data.notes.map(n => (n.id === event.noteId ? { ...n, icon: event.icon } : n)),
          currentNote: data.currentNoteId === event.noteId && data.currentNote
            ? { ...data.currentNote, icon: event.icon }
            : data.currentNote,
          writes: writeSent(data.writes as ViewWrites, key),
        },
      };
    },
    'NOTE.TOGGLE_FAVORITE': (event, { data, call }) => {
      const existing = data.notes.find(n => n.id === event.noteId);
      const newFavorite = !existing?.favorite;
      let writes = data.writes as ViewWrites;
      if (existing) {
        const key = freshKey();
        call('updateNote', key, { id: event.noteId, favorite: newFavorite });
        writes = writeSent(writes, key);
      }
      return {
        data: {
          notes: data.notes.map(n => (n.id === event.noteId ? { ...n, favorite: newFavorite } : n)),
          currentNote: data.currentNoteId === event.noteId && data.currentNote
            ? { ...data.currentNote, favorite: newFavorite }
            : data.currentNote,
          selectedTask: data.selectedTaskId === event.noteId && data.selectedTask
            ? { ...data.selectedTask, favorite: newFavorite }
            : data.selectedTask,
          writes,
        },
      };
    },
    'TASK.SELECT': (event, { data }) => ({
      data: {
        selectedTaskId: event.taskId,
        selectedTask: data.notes.find(n => n.id === event.taskId) || null,
      },
    }),
    'TASK.DESELECT': () => ({ data: { selectedTaskId: null, selectedTask: null } }),
    'TASK.TOGGLE_COMPLETE': (event, { data, call }) => {
      const task = data.notes.find(n => n.id === event.taskId);
      if (!task) return;
      const key = freshKey();
      call('updateNote', key, { id: event.taskId, completed: !task.completed });
      return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
    },
    'TASK.UPDATE_CONTENT': (event, { data, call }) => {
      const key = freshKey();
      call('updateNote', key, { id: event.taskId, content: event.content });
      return {
        data: {
          contents: { ...data.contents, [event.taskId]: event.content },
          writes: writeSent(data.writes as ViewWrites, key),
        },
      };
    },
    'TASK.UPDATE_TITLE': (event, { data, call }) => {
      const key = freshKey();
      call('updateNote', key, { id: event.taskId, title: event.title });
      return {
        data: {
          notes: data.notes.map(n => (n.id === event.taskId ? { ...n, title: event.title } : n)),
          selectedTask: data.selectedTaskId === event.taskId && data.selectedTask
            ? { ...data.selectedTask, title: event.title }
            : data.selectedTask,
          writes: writeSent(data.writes as ViewWrites, key),
        },
      };
    },
    'TASK.DELETE': (event, { data, call }) => {
      const key = freshKey();
      call('deleteNote', key, { id: event.taskId });
      return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
    },
    'TASK.TOGGLE_SHOW_COMPLETED': (_event, { data, call }) => {
      if (!data.currentNoteId) return;
      const note = data.notes.find(n => n.id === data.currentNoteId);
      if (!note) return;
      const key = freshKey();
      call('updateNote', key, { id: data.currentNoteId, hideCompletedChildren: !note.hideCompletedChildren });
      return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
    },
    'TASK.TOGGLE_HIDE_COMPLETED_CHILDREN': (event, { data, call }) => {
      const note = data.notes.find(n => n.id === event.nodeId);
      if (!note) return;
      const key = freshKey();
      call('updateNote', key, { id: event.nodeId, hideCompletedChildren: !note.hideCompletedChildren });
      return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
    },
    'NOTE.SHOW_TRASH': () => ({ data: { showTrash: true } }),
    'NOTE.HIDE_TRASH': () => ({ data: { showTrash: false } }),
    'NOTE.PERMANENTLY_DELETE': (event, { data, call }) => {
      const key = freshKey();
      call('permanentlyDeleteNote', key, { id: event.noteId });
      return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
    },
    'NOTE.EMPTY_TRASH': (_event, { data, call }) => {
      const key = freshKey();
      call('emptyTrash', key);
      return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
    },
    'NOTE.SAVE_SCROLL': (event, { data }) => ({
      data: { noteScrollPositions: { ...data.noteScrollPositions, [event.noteId]: event.scrollTop } },
    }),
    'NOTE.TOGGLE_PANEL_SEARCH': (_event, { data }) => ({ data: { panelSearchActive: !data.panelSearchActive } }),
    NAVIGATE_BACK: (_event, { data }) => {
      const nav = data.navHistory as NavHistory<string | null>;
      if (!canGoBack(nav)) return;
      const target = nav.stack[nav.index - 1];
      if (target === null) {
        const result = goBack(nav)!;
        return { at: 'welcome', data: { navHistory: result.history, currentNoteId: null, currentNote: null } };
      }
      if (data.notes.some(n => n.id === target)) {
        const result = goBack(nav)!;
        const note = data.notes.find(n => n.id === result.entry) || null;
        return {
          at: 'editor',
          data: {
            navHistory: result.history,
            currentNoteId: result.entry,
            currentNote: note,
            selectedTaskId: null,
            selectedTask: null,
          },
        };
      }
    },
    NAVIGATE_FORWARD: (_event, { data }) => {
      const nav = data.navHistory as NavHistory<string | null>;
      if (!canGoForward(nav)) return;
      const target = nav.stack[nav.index + 1];
      if (target === null) {
        const result = goForward(nav)!;
        return { at: 'welcome', data: { navHistory: result.history, currentNoteId: null, currentNote: null } };
      }
      if (data.notes.some(n => n.id === target)) {
        const result = goForward(nav)!;
        const note = data.notes.find(n => n.id === result.entry) || null;
        return {
          at: 'editor',
          data: {
            navHistory: result.history,
            currentNoteId: result.entry,
            currentNote: note,
            selectedTaskId: null,
            selectedTask: null,
          },
        };
      }
    },
    TRAIL_CLICK: (event, { data, tell }) => {
      if (event.target === 'welcome') {
        return {
          at: 'welcome',
          data: {
            currentNoteId: null,
            currentNote: null,
            navHistory: pushNavHistory(data.navHistory as NavHistory<string | null>, null),
          },
        };
      }
      if (event.target === 'editor') {
        const noteId = event.info;
        if (!noteId) {
          const fallback = data.viewedNoteId ?? data.currentNoteId;
          if (fallback) tell(id, { type: 'VIEW_NOTE', id: fallback });
          return { at: 'editor' };
        }
        const note = data.notes.find(n => n.id === noteId) || null;
        tell(id, { type: 'VIEW_NOTE', id: noteId });

        if (note?.noteType === 'task') {
          const taskList = findNearestTaskList(data.notes, noteId);
          if (taskList) {
            return {
              at: 'editor',
              data: {
                currentNoteId: taskList.id,
                currentNote: taskList,
                viewedNoteId: noteId,
                selectedTaskId: noteId,
                selectedTask: note,
                navHistory: pushNavHistory(data.navHistory as NavHistory<string | null>, taskList.id),
              },
            };
          }
        }

        return {
          at: 'editor',
          data: {
            currentNoteId: noteId,
            currentNote: note,
            viewedNoteId: noteId,
            selectedTaskId: null,
            selectedTask: null,
            navHistory: pushNavHistory(data.navHistory as NavHistory<string | null>, noteId),
          },
        };
      }
    },
  },
  states: {
    welcome: {
      on: {
        'NOTE.CREATE': (event, { data, call }) => {
          const key = freshKey();
          call('createNote', key, {
            title: event.title ?? 'Untitled',
            content: event.content,
            parentId: event.parentId,
            displayOrder: event.displayOrder,
          });
          return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
        },
        'NOTE.CREATE_TASKLIST': (event, { data, call }) => {
          const key = freshKey();
          call('createNote', key, {
            title: 'Untitled',
            noteType: 'tasklist',
            parentId: event.parentId,
          });
          return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
        },
        'TASK.CREATE': (event, { data, call }) => {
          const key = freshKey();
          call('createNote', key, {
            title: 'Untitled',
            parentId: event.parentId,
            skipContentSync: true,
            noteType: 'task',
          });
          return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
        },
        'NOTE.SELECT': (event, { data, tell }) => {
          tell(id, { type: 'VIEW_NOTE', id: event.noteId });
          return { at: 'editor', data: selectNoteData(data, event.noteId, '_historyNav' in event) };
        },
        'NOTE.OPEN': (event, { data, tell }) => {
          tell(id, { type: 'VIEW_NOTE', id: event.noteId });
          return { at: 'editor', data: openNoteData(data, event.noteId) };
        },
        'NOTE.DELETE': (event, { data, call }) => {
          const key = freshKey();
          call('deleteNote', key, { id: event.noteId });
          return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
        },
      },
    },
    editor: {
      on: {
        'NOTE.SELECT': (event, { data, tell }) => {
          tell(id, { type: 'VIEW_NOTE', id: event.noteId });
          return { data: selectNoteData(data, event.noteId, '_historyNav' in event) };
        },
        'NOTE.OPEN': (event, { data, tell }) => {
          tell(id, { type: 'VIEW_NOTE', id: event.noteId });
          return { data: openNoteData(data, event.noteId) };
        },
        'NOTE.CREATE': (event, { data, call }) => {
          const key = freshKey();
          call('createNote', key, {
            title: event.title ?? 'Untitled',
            content: event.content,
            parentId: event.parentId,
            displayOrder: event.displayOrder,
          });
          return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
        },
        'NOTE.CREATE_TASKLIST': (event, { data, call }) => {
          const key = freshKey();
          call('createNote', key, {
            title: 'Untitled',
            noteType: 'tasklist',
            parentId: event.parentId,
          });
          return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
        },
        'TASK.CREATE': (event, { data, call }) => {
          const key = freshKey();
          call('createNote', key, {
            title: 'Untitled',
            parentId: event.parentId,
            skipContentSync: true,
            noteType: 'task',
          });
          return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
        },
        'NOTE.DELETE': (event, { data, call }) => {
          const key = freshKey();
          call('deleteNote', key, { id: event.noteId });
          return { data: { writes: writeSent(data.writes as ViewWrites, key) } };
        },
        'NOTE.LINK_CLICKED': (event, { data, tell }) => {
          tell(id, { type: 'VIEW_NOTE', id: event.noteId });
          return { data: selectNoteData(data, event.noteId, '_historyNav' in event) };
        },
        'NOTE.REQUEST_DOCUMENT_INSERT': (event, { data, call }) => {
          const key = freshKey();
          call('createNote', key, {
            title: 'Untitled',
            parentId: event.parentId,
            skipContentSync: true,
          });
          return {
            data: {
              pendingSubDocumentInsert: { cursorPos: event.cursorPos },
              writes: writeSent(data.writes as ViewWrites, key),
            },
          };
        },
        VIEW_WELCOME: (_event, { data }) => ({
          at: 'welcome',
          data: {
            currentNoteId: null,
            currentNote: null,
            navHistory: pushNavHistory(data.navHistory as NavHistory<string | null>, null),
          },
        }),
      },
    },
  },
});

export default notesState;
