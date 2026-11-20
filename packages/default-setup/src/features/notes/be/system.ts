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

import { exportNotes } from './export-notes.ts';
import { importNotes } from './import-notes.ts';
import { createLogger } from '@apackdev/sdk/logger';
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


/** Whether putting `noteId` under `newParentId` would put a note inside itself */
const wouldNestInItself = (noteId: EARS.EntityId, newParentId: EARS.EntityId) =>
  wouldCreateCycle(newParentId, noteId, [EARS.RelKind.CONTAINS]);

export const notesSpec = defineSystem<Contract>();

/**
 * A window's writes to its notes, each answered to whoever asked: with the note it made, or that it landed, or why it
 * was refused. The surface applies its own edits at once and holds the notes' views while any of its writes is
 * unanswered (`ViewWrites`, `@apackdev/sdk/fe`), which the table holds whichever way a handler ends. The write runs
 * whether or not anybody asked: an applier's or a migration's has none, and its refusal is reported.
 */
export const answers = notesSpec.answers({
  CREATE_NOTE: ({ ask }) => {
    const note = repository.noteCommands.create({
      title: ask.title,
      content: ask.content,
      icon: ask.icon,
      parentId: ask.parentId,
      noteType: ask.noteType,
      completed: ask.completed,
      displayOrder: ask.displayOrder,
    });

    // If this note has a parent, append sub-document link to parent content
    if (ask.parentId && !ask.skipContentSync) {
      const parentNote = repository.noteQueries.byId(ask.parentId as EARS.EntityId);
      if (parentNote) {
        const linkMarkdown = `\n\n[${ask.title}](document://${note.id})`;
        const newContent = (parentNote.content || '') + linkMarkdown;
        repository.noteCommands.update(ask.parentId as EARS.EntityId, { content: newContent });
      }
    }

    const summary = repository.noteQueries.summary(note.id as EARS.EntityId);
    // Only the window that asked opens it; every window's tree has it through the tree view
    return summary ? { note: summary } : {};
  },
  UPDATE_NOTE: ({ ask }) => {
    const noteId = ask.id as EARS.EntityId;
    const noteBeforeUpdate = repository.noteQueries.byId(noteId) as NoteEntity | undefined;
    if (!noteBeforeUpdate) throw new Error(`No note ${noteId}`);
    const updates: Record<string, any> = {};

    if (ask.title !== undefined) updates.title = ask.title;
    if (ask.content !== undefined) updates.content = ask.content;
    if (ask.icon !== undefined) updates.icon = ask.icon;
    if (ask.hideCompletedChildren !== undefined) updates.hideCompletedChildren = ask.hideCompletedChildren;
    if (ask.favorite !== undefined) updates.favorite = ask.favorite;
    if (ask.completed !== undefined) {
      updates.completed = ask.completed;
      // When completing: save current displayOrder
      if (ask.completed && !noteBeforeUpdate.completed) {
        updates.savedDisplayOrder = noteBeforeUpdate.displayOrder;
      }
    }

    repository.noteCommands.update(noteId, updates);

    // When uncompleting: restore saved position
    // A cleared position is removed, so the note holds none
    if (ask.completed === false && noteBeforeUpdate.savedDisplayOrder != null) {
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
      if (ask.title !== undefined && updatedNote.parentId) {
        const parentNote = repository.noteQueries.byId(updatedNote.parentId as EARS.EntityId);
        if (parentNote?.content) {
          const linkPattern = new RegExp(
            `\\[([^\\]]*)\\]\\(document:\\/\\/${(noteId as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`,
            'g'
          );
          const newContent = parentNote.content.replace(linkPattern, `[${ask.title}](document://${noteId})`);
          if (newContent !== parentNote.content) {
            repository.noteCommands.update(updatedNote.parentId as EARS.EntityId, { content: newContent });
          }
        }
      }
    }
  },
  DELETE_NOTE: ({ ask }) => {
    // Get parent before deletion for update
    const noteDTO = repository.noteQueries.byIdDTO(ask.id as EARS.EntityId);
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
    const descendantIds = collectDescendants(ask.id as EARS.EntityId);

    // Remove link markdown from referencing notes before deletion
    const allDeletedIds = [ask.id, ...descendantIds];
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
    repository.noteCommands.softDelete(ask.id as EARS.EntityId);
  },
  SOFT_DELETE_NOTE: ({ ask }) => { repository.noteCommands.softDelete(ask.id as EARS.EntityId); },
  RESTORE_NOTE: ({ ask }) => { repository.noteCommands.restore(ask.id as EARS.EntityId); },
  MOVE_NOTE: ({ ask }) => {
  const newParentId = ask.newParentId as EARS.EntityId | null;

    for (const noteId of ask.ids) {
      const id = noteId as EARS.EntityId;

      // Skip a drop onto itself or into its own subtree
      if (newParentId && wouldNestInItself(id, newParentId)) continue;

      // Find current parent to skip same-parent no-op
      const currentParentIds = query.ids(id).in(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids();
      const currentParentId = currentParentIds.length > 0 ? currentParentIds[0] : null;
      if (currentParentId === newParentId) continue;

      repository.noteCommands.move(id, newParentId);
    }
  },
  REORDER_NOTE: ({ ask }) => {
  const noteId = ask.id as EARS.EntityId;
  const newParentId = ask.newParentId as EARS.EntityId | null;

    // Skip a drop onto itself or into its own subtree
    if (newParentId && wouldNestInItself(noteId, newParentId)) return;
    repository.noteCommands.reorder(noteId, newParentId, ask.newIndex);
  },
  PERMANENTLY_DELETE_NOTE: ({ ask }) => { repository.noteCommands.delete(ask.id as EARS.EntityId); },
  EMPTY_TRASH: () => {
    for (const note of repository.noteQueries.trashedDTOs()) {
      try {
        repository.noteCommands.delete(note.id as EARS.EntityId);
      } catch {
        // Gone already: deleted with its parent, or by another window
      }
    }
  },
})

export const notesSystem = setup({
  types: notesSpec.types,
  actions: { ...answers.actions, ...notesSpec.actions({
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

  }) },
}).createMachine({
  id: 'notes',
  initial: 'idle',
  context: () => ({}),
  on: {
    ...answers.on,
    VIEW_NOTE: {
      actions: 'viewNote',
    },
    IMPORT_NOTES: {
      actions: 'importNotesItems',
    },
    EXPORT_NOTES: {
      actions: 'exportNotesToFile',
    },
  },
  states: {
    idle: {
      entry: 'cleanupExpiredNotes',
    },
  },
});

const notesEntry = { spec: notesSpec, machine: notesSystem };

export default notesEntry;
