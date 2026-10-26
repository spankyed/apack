import { query } from '#generated/ears.ts';
import { wouldCreateCycle } from '@apackdev/sdk/ears';
import { broadcastToSurface } from '#generated/events.ts';
import { setup } from 'xstate';
import type { Reply } from '@apackdev/sdk/events';
import type { OutgoingNotesEvents } from './types.ts';
import { defineSystem } from '@apackdev/sdk/framework';

import { EARS } from '#generated/ears.ts';
import type { Contract } from './contract.ts';
import { repository } from '#generated/repository.ts';

import { syncReferences } from './repository/link-utils.ts';
import { exportNotes } from './export-notes.ts';
import { importNotes } from './import-notes.ts';
import { createLogger, reportError } from '@apackdev/sdk/logger';
import type { NoteEntity } from '#features/notes/be/types.ts';

/** What may fall back to every window: a command's outcome, which someone must hear, and never data a window shows */
type OutcomeType = 'NOTES_EXPORT_FAILED' | 'NOTES_EXPORTED' | 'NOTES_IMPORT_FAILED' | 'NOTES_IMPORTED'
type Outcome = Extract<OutgoingNotesEvents, { type: OutcomeType }>

/**
 * Answers whoever asked for this, and tells every window when nobody did.
 *
 * An import's or an export's *outcome* belongs to the window that started it — another window showing
 * "imported 12" for work it did not do, and flipping its own status to success, is what broadcasting it
 * did. The notes the import wrote reach every window through the feature's views. `answerSettings`
 * (`@apackdev/host`) is the same shape for the same reason.
 */
const answer = (reply: Reply<OutgoingNotesEvents> | undefined, event: Outcome): void =>
  (reply ? reply(event) : broadcastToSurface('notes', event));
import { errorMessage } from '@apackdev/sdk/utils/pure';

const logger = createLogger('notes');

/**
 * One of a window's writes to its notes, answered to whoever asked: with the note it made, or that it landed, or why
 * it was refused. The surface applies its own edits at once and holds the notes' views while any of its writes is
 * unanswered (`ViewWrites`, `@apackdev/sdk/fe`), so every write is answered, a refusal included. The write runs
 * whether or not anybody asked: an applier's or a migration's has no `reply`, and its refusal is reported, since no
 * window shows it.
 */
function answerWrite(reply: Reply<OutgoingNotesEvents> | undefined, label: string, write: () => OutgoingNotesEvents | void): void {
  let answer: OutgoingNotesEvents;
  try {
    answer = write() ?? { type: 'NOTE_WRITTEN' };
  } catch (error) {
    if (reply) {
      logger.warn(`${label} failed`, { error: errorMessage(error) });
      reply({ type: 'NOTE_WRITE_FAILED', error: errorMessage(error) || `${label} failed` });
    } else {
      reportError({ error, title: `${label} failed`, source: 'notes' });
    }
    return;
  }
  reply?.(answer);
}

/** Whether putting `noteId` under `newParentId` would put a note inside itself */
const wouldNestInItself = (noteId: EARS.EntityId, newParentId: EARS.EntityId) =>
  wouldCreateCycle(newParentId, noteId, [EARS.RelKind.CONTAINS]);

export const notesSpec = defineSystem<Contract>();

export const notesSystem = setup({
  types: notesSpec.types,
  actions: notesSpec.actions({
    createNote: ({ event, reply }) => {
      const ev = notesSpec.typeOf('CREATE_NOTE', event);
      answerWrite(reply, 'Creating a note', () => {
        const note = repository.noteCommands.create({
          title: ev.title,
          content: ev.content,
          icon: ev.icon,
          parentId: ev.parentId,
          noteType: ev.noteType,
          completed: ev.completed,
          displayOrder: ev.displayOrder,
        });

        // If this note has a parent, append sub-document link to parent content
        if (ev.parentId && !ev.skipContentSync) {
          const parentNote = repository.noteQueries.byId(ev.parentId as EARS.EntityId);
          if (parentNote) {
            const linkMarkdown = `\n\n[${ev.title}](document://${note.id})`;
            const newContent = (parentNote.content || '') + linkMarkdown;
            repository.noteCommands.update(ev.parentId as EARS.EntityId, { content: newContent });
          }
        }

        const summary = repository.noteQueries.summary(note.id as EARS.EntityId);
        // Only the window that asked opens it; every window's tree has it through the tree view
        if (summary) return { type: 'NOTE_CREATED', note: summary };
      });
    },

    updateNote: ({ event, reply }) => {
      const ev = notesSpec.typeOf('UPDATE_NOTE', event);
      answerWrite(reply, 'Updating a note', () => {
        const noteId = ev.id as EARS.EntityId;
        const noteBeforeUpdate = repository.noteQueries.byId(noteId) as NoteEntity | undefined;
        if (!noteBeforeUpdate) throw new Error(`No note ${noteId}`);
        const updates: Record<string, any> = {};

        if (ev.title !== undefined) updates.title = ev.title;
        if (ev.content !== undefined) updates.content = ev.content;
        if (ev.icon !== undefined) updates.icon = ev.icon;
        if (ev.hideCompletedChildren !== undefined) updates.hideCompletedChildren = ev.hideCompletedChildren;
        if (ev.favorite !== undefined) updates.favorite = ev.favorite;
        if (ev.completed !== undefined) {
          updates.completed = ev.completed;
          // When completing: save current displayOrder
          if (ev.completed && !noteBeforeUpdate.completed) {
            updates.savedDisplayOrder = noteBeforeUpdate.displayOrder;
          }
        }

        repository.noteCommands.update(noteId, updates);

        // When uncompleting: restore saved position
        // A cleared position is stored as null
        if (ev.completed === false && noteBeforeUpdate.savedDisplayOrder != null) {
          const parentIds = query.ids(noteId).in(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids();
          const parentId = parentIds.length > 0 ? parentIds[0] : null;
          repository.noteCommands.reorder(
            noteId,
            parentId,
            noteBeforeUpdate.savedDisplayOrder
          );
          repository.noteCommands.update(noteId, { savedDisplayOrder: null }, true);
        }

        const updatedNote = repository.noteQueries.byIdDTO(noteId);
        if (updatedNote) {
          // Sync sub-document link title in parent note when child is renamed
          if (ev.title !== undefined && updatedNote.parentId) {
            const parentNote = repository.noteQueries.byId(updatedNote.parentId as EARS.EntityId);
            if (parentNote?.content) {
              const linkPattern = new RegExp(
                `\\[([^\\]]*)\\]\\(document:\\/\\/${(noteId as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`,
                'g'
              );
              const newContent = parentNote.content.replace(linkPattern, `[${ev.title}](document://${noteId})`);
              if (newContent !== parentNote.content) {
                repository.noteCommands.update(updatedNote.parentId as EARS.EntityId, { content: newContent });
              }
            }
          }
        }
      });
    },

    // Every note's links, in the trash or not, derived again from its text: data written before a note recorded
    // its link targets gets them here, and data replaced wholesale is indexed afresh
    bootstrapReferences: () => {
      const allNotes = query.withTrashed(EARS.Entity.Note).pick(['content']);
      for (const note of allNotes) {
        syncReferences(note.id as EARS.EntityId, (note.content as string | undefined) ?? '');
      }
      logger.info(`Bootstrapped REFERENCES relations for ${allNotes.length} notes`);
    },

    softDeleteNote: ({ event, reply }) => {
      const ev = notesSpec.typeOf('SOFT_DELETE_NOTE', event);
      answerWrite(reply, 'Moving a note to the trash', () => { repository.noteCommands.softDelete(ev.id as EARS.EntityId); });
    },

    restoreNote: ({ event, reply }) => {
      const ev = notesSpec.typeOf('RESTORE_NOTE', event);
      answerWrite(reply, 'Restoring a note', () => { repository.noteCommands.restore(ev.id as EARS.EntityId); });
    },

    cleanupExpiredNotes: () => {
      const expired = repository.noteQueries.expiredSoftDeleted(7);
      if (expired.length === 0) return;
      for (const note of expired) {
        try {
          repository.noteCommands.delete(note.id as EARS.EntityId);
        } catch {
          // Already deleted or missing — skip
        }
      }
      logger.info(`Cleaned up ${expired.length} expired soft-deleted notes`);
    },

    moveNotes: ({ event, reply }) => {
      const ev = notesSpec.typeOf('MOVE_NOTE', event);
      const newParentId = ev.newParentId as EARS.EntityId | null;
      answerWrite(reply, 'Moving notes', () => {
        for (const noteId of ev.ids) {
          const id = noteId as EARS.EntityId;

          // Skip a drop onto itself or into its own subtree
          if (newParentId && wouldNestInItself(id, newParentId)) continue;

          // Find current parent to skip same-parent no-op
          const currentParentIds = query.ids(id).in(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids();
          const currentParentId = currentParentIds.length > 0 ? currentParentIds[0] : null;
          if (currentParentId === newParentId) continue;

          repository.noteCommands.move(id, newParentId);
        }
      });
    },

    reorderNote: ({ event, reply }) => {
      const ev = notesSpec.typeOf('REORDER_NOTE', event);
      const noteId = ev.id as EARS.EntityId;
      const newParentId = ev.newParentId as EARS.EntityId | null;
      answerWrite(reply, 'Reordering a note', () => {
        // Skip a drop onto itself or into its own subtree
        if (newParentId && wouldNestInItself(noteId, newParentId)) return;
        repository.noteCommands.reorder(noteId, newParentId, ev.newIndex);
      });
    },

    importNotesItems: ({ event, reply }) => {
      const ev = event as { type: 'IMPORT_NOTES'; directory: string };
      try {
        const result = importNotes(ev.directory);

        if (result.created === 0 && result.errors.length > 0) {
          answer(reply, {
            type: 'NOTES_IMPORT_FAILED',
            errors: result.errors,
          });
          return;
        }

        answer(reply, {
          type: 'NOTES_IMPORTED',
          count: result.created,
          ...(result.errors.length > 0 ? { errors: result.errors } : {}),
        });

      } catch (err) {
        const message = errorMessage(err);
        answer(reply, {
          type: 'NOTES_IMPORT_FAILED',
          errors: [message],
        });
      }
    },

    exportNotesToFile: ({ event, reply }) => {
      const ev = event as { type: 'EXPORT_NOTES'; directory: string; format: 'markdown' | 'json' };
      try {
        const { filePath, itemCount } = exportNotes(ev.directory, ev.format);

        answer(reply, {
          type: 'NOTES_EXPORTED',
          filePath,
          itemCount,
        });
      } catch (err) {
        const message = errorMessage(err);
        answer(reply, {
          type: 'NOTES_EXPORT_FAILED',
          errors: [message],
        });
      }
    },

    viewNote: ({ event }) => {
      const ev = notesSpec.typeOf('VIEW_NOTE', event);
      if (!repository.noteQueries.byId(ev.id as EARS.EntityId)) return;
      repository.noteCommands.update(ev.id as EARS.EntityId, { lastSeen: Date.now() }, true);
    },

    deleteNote: ({ event, reply }) => {
      const ev = notesSpec.typeOf('DELETE_NOTE', event);
      answerWrite(reply, 'Deleting a note', () => {
        // Get parent before deletion for update
        const noteDTO = repository.noteQueries.byIdDTO(ev.id as EARS.EntityId);
        const parentId = noteDTO?.parentId;

        // Collect all descendant IDs before soft-deletion
        const collectDescendants = (id: EARS.EntityId): string[] => {
          const children = repository.noteQueries.children(id);
          const descendantIds: string[] = [];
          for (const child of children) {
            descendantIds.push(child.id);
            descendantIds.push(...collectDescendants(child.id as EARS.EntityId));
          }
          return descendantIds;
        };
        const descendantIds = collectDescendants(ev.id as EARS.EntityId);

        // Remove link markdown from referencing notes before deletion
        const allDeletedIds = [ev.id, ...descendantIds];
        const deletedSet = new Set(allDeletedIds);
        const affectedRefIds = new Set<string>();

        for (const deletedId of allDeletedIds) {
          const refIds = repository.noteQueries.referencedBy(deletedId as EARS.EntityId);
          for (const refId of refIds) {
            if (!deletedSet.has(refId)) {
              affectedRefIds.add(refId);
            }
          }
        }

        for (const refId of affectedRefIds) {
          const note = repository.noteQueries.byId(refId as EARS.EntityId);
          if (!note?.content) continue;

          let newContent = note.content;
          for (const deletedId of allDeletedIds) {
            const escaped = deletedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const linkPattern = new RegExp(`\\[([^\\]]*)\\]\\(note:\\/\\/${escaped}\\)`, 'g');
            newContent = newContent.replace(linkPattern, '$1');
          }
          if (newContent === note.content) continue;

          repository.noteCommands.update(refId as EARS.EntityId, { content: newContent });
        }

        // Strip document:// links from parent note content (no REFERENCES relation for these)
        if (parentId) {
          const parentNote = repository.noteQueries.byId(parentId as EARS.EntityId);
          if (parentNote?.content) {
            let newContent = parentNote.content;
            for (const deletedId of allDeletedIds) {
              const escaped = deletedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const documentPattern = new RegExp(`\\\\?\\[([^\\]\\\\]*)\\\\?\\]\\(document:\\/\\/${escaped}(?:\\?[^)]*)?\\)\\n?\\n?`, 'g');
              newContent = newContent.replace(documentPattern, '');
            }
            if (newContent !== parentNote.content) {
              repository.noteCommands.update(parentId as EARS.EntityId, { content: newContent });
            }
          }
        }

        // Soft-delete instead of hard-delete (moves to trash)
        repository.noteCommands.softDelete(ev.id as EARS.EntityId);
      });
    },

    permanentlyDeleteNote: ({ event, reply }) => {
      const ev = notesSpec.typeOf('PERMANENTLY_DELETE_NOTE', event);
      answerWrite(reply, 'Deleting a note for good', () => { repository.noteCommands.delete(ev.id as EARS.EntityId); });
    },

    emptyTrash: ({ reply }) => {
      answerWrite(reply, 'Emptying the trash', () => {
        for (const note of repository.noteQueries.trashedDTOs()) {
          try {
            repository.noteCommands.delete(note.id as EARS.EntityId);
          } catch {
            // Gone already: deleted with its parent, or by another window
          }
        }
      });
    },
  }),
}).createMachine({
  id: 'notes',
  initial: 'idle',
  context: () => ({}),
  on: {
    CREATE_NOTE: {
      actions: 'createNote',
    },
    UPDATE_NOTE: {
      actions: 'updateNote',
    },
    DELETE_NOTE: {
      actions: 'deleteNote',
    },
    SOFT_DELETE_NOTE: {
      actions: 'softDeleteNote',
    },
    RESTORE_NOTE: {
      actions: 'restoreNote',
    },
    MOVE_NOTE: {
      actions: 'moveNotes',
    },
    REORDER_NOTE: {
      actions: 'reorderNote',
    },
    VIEW_NOTE: {
      actions: 'viewNote',
    },
    IMPORT_NOTES: {
      actions: 'importNotesItems',
    },
    PERMANENTLY_DELETE_NOTE: {
      actions: 'permanentlyDeleteNote',
    },
    EMPTY_TRASH: {
      actions: 'emptyTrash',
    },
    EXPORT_NOTES: {
      actions: 'exportNotesToFile',
    },
  },
  states: {
    idle: {
      entry: ['bootstrapReferences', 'cleanupExpiredNotes'],
      on: {
        // References are an index derived from note text, so data restored or reset is indexed again from its text
        DATA_REPLACED: {
          actions: 'bootstrapReferences',
        },
      },
    },
  },
});

const notesEntry = { spec: notesSpec, machine: notesSystem };

export default notesEntry;
