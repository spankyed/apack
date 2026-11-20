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
 * note it made, for the window that asked to open.
 */
export type NoteAsks = {
  CREATE_NOTE: { ask: { title: string; content?: string; icon?: string | null; parentId?: string; skipContentSync?: boolean; noteType?: 'document' | 'tasklist' | 'task'; completed?: boolean; displayOrder?: number }; answer: { note?: NoteSummary } }
  UPDATE_NOTE: { ask: { id: string; title?: string; content?: string; icon?: string | null; completed?: boolean; hideCompletedChildren?: boolean; favorite?: boolean } }
  DELETE_NOTE: { ask: { id: string } }
  SOFT_DELETE_NOTE: { ask: { id: string } }
  RESTORE_NOTE: { ask: { id: string } }
  MOVE_NOTE: { ask: { ids: string[]; newParentId: string | null } }
  REORDER_NOTE: { ask: { id: string; newParentId: string | null; newIndex: number } }
  PERMANENTLY_DELETE_NOTE: { ask: { id: string } }
  EMPTY_TRASH: {}
}

/** What a window tells the notes system and is not answered for, and the import and export every window hears of */
export type IncomingNoteEvents =
  | { type: 'VIEW_NOTE'; id: string }
  | { type: 'IMPORT_NOTES'; directory: string }
  | { type: 'EXPORT_NOTES'; directory: string; format: 'markdown' | 'json' };

/** What the notes system sends beside its answers: an import's or an export's outcome. The notes themselves are its views */
export type OutgoingNotesEvents =
  | { type: 'NOTES_IMPORTED'; count: number; errors?: string[] }
  | { type: 'NOTES_IMPORT_FAILED'; errors: string[] }
  | { type: 'NOTES_EXPORTED'; filePath: string; itemCount: number }
  | { type: 'NOTES_EXPORT_FAILED'; errors: string[] }
