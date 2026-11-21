export type * from './export-types.ts';
import { type BaseEntity, EARS } from '#generated/ears.ts';

export interface NoteEntity extends BaseEntity {
  entityType: EARS.Entity.Note;
  title: string;
  content: string;
  icon: string | null;
  noteType: 'document' | 'tasklist' | 'task';
  completed: boolean;
  hideCompletedChildren: boolean;
  displayOrder: number;
  savedDisplayOrder?: number;
  createdAt: number;
  updatedAt: number;
  lastSeen: number;
  favorite?: boolean;
  /** Hash of the content source at the last apply. Absent on user-created notes. */
  contentHash?: string;
  /** Every note id the content's links name, derived from it (`syncReferences`); absent when it links to none */
  linkTargets?: string[];
}

export interface NoteDTO {
  id: string;
  title: string;
  content: string;
  icon: string | null;
  noteType: 'document' | 'tasklist' | 'task';
  completed: boolean;
  hideCompletedChildren: boolean;
  parentId: string | null;
  displayOrder: number;
  savedDisplayOrder: number | null;
  childCount: number;
  createdAt: number;
  updatedAt: number;
  lastSeen: number;
  favorite: boolean;
  /** When the note was put in the trash, for a note listed from there */
  trashedAt?: number;
}

/**
 * A note as the tree shows it: its place and its flags, without its text and without the times every write moves.
 * What the tree view reads, so typing in a note re-runs the view showing that note and not the one showing every note.
 */
export type NoteSummary = Omit<NoteDTO, 'content' | 'updatedAt' | 'lastSeen'>;

/** A note as the welcome page shows it, with when it last changed */
export type RecentNote = Pick<NoteDTO, 'id' | 'title' | 'icon' | 'noteType' | 'updatedAt'>;

// ── This feature's settings ───────────────────────────────────────────────
// Its own shape, which the app stores without knowing: the app owns the document, each feature its slice.
export type NotesSettings = import('#generated/settings.ts').SettingsOf<'notes'>;

/**
 * A window's writes to its notes, each answered once: the surface applies its own edits at once and holds the notes'
 * views while any of its writes is unanswered (`ViewWrites`), so every write is an ask. Creating one answers with the
 * note it made, for the window that asked to open; an import or an export answers with what it did.
 */
export type NoteAsks = {
  CREATE_NOTE: { args: { title: string; content?: string; icon?: string | null; parentId?: string; skipContentSync?: boolean; noteType?: 'document' | 'tasklist' | 'task'; completed?: boolean; displayOrder?: number }; answer: { note?: NoteSummary } }
  UPDATE_NOTE: { args: { id: string; title?: string; content?: string; icon?: string | null; completed?: boolean; hideCompletedChildren?: boolean; favorite?: boolean } }
  DELETE_NOTE: { args: { id: string } }
  SOFT_DELETE_NOTE: { args: { id: string } }
  RESTORE_NOTE: { args: { id: string } }
  MOVE_NOTE: { args: { ids: string[]; newParentId: string | null } }
  REORDER_NOTE: { args: { id: string; newParentId: string | null; newIndex: number } }
  PERMANENTLY_DELETE_NOTE: { args: { id: string } }
  EMPTY_TRASH: {}
  EXPORT_NOTES: { args: { directory: string; format: 'markdown' | 'json' }; answer: { filePath: string; itemCount: number } }
  /** Imported with what could not be, unless nothing could, which fails */
  IMPORT_NOTES: { args: { directory: string }; answer: { count: number; errors?: string[] } }
}

/** What a window tells the notes system and is not answered for */
export type IncomingNoteEvents =
  | { type: 'VIEW_NOTE'; id: string };

/** The notes system sends no window anything of its own: the notes are its views, and each ask is answered */
export type OutgoingNotesEvents = never
