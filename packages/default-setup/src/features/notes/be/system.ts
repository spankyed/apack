import { query } from '#generated/ears.ts';
import { wouldCreateCycle } from '@apackdev/sdk/ears';
import { setup } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';

import { EARS } from '#generated/ears.ts';
import type { Contract } from './contract.ts';
import { repository } from '#generated/repository.ts';

import { exportNotes } from './export-notes.ts';
import { importNotes } from './import-notes.ts';
import { createLogger } from '@apackdev/sdk/logger';
import type { NoteEntity } from '#features/notes/be/types.ts';


const logger = createLogger('notes');


/** Whether putting `noteId` under `newParentId` would put a note inside itself */
const wouldNestInItself = (noteId: EARS.EntityId, newParentId: EARS.EntityId) =>
  wouldCreateCycle(newParentId, noteId, [EARS.RelKind.CONTAINS]);

export const notesSpec = defineSystem<Contract>();

/**
 * A window's writes to its notes and its imports and exports, each answered to whoever asked: with the note it made,
 * what it imported or exported, or that it landed, or why it was refused. The surface applies its own edits at once
 * and holds the notes' views while any of its writes is unanswered (`ViewWrites`, `@apackdev/sdk/fe`), which the
 * table holds whichever way a handler ends. The write runs
 * whether or not anybody asked: an applier's or a migration's has none, and its refusal is reported.
 */
export const answers = notesSpec.answers({
  CREATE_NOTE: ({ args }) => {
    const note = repository.noteCommands.create({
      title: args.title,
      content: args.content,
      icon: args.icon,
      parentId: args.parentId,
      noteType: args.noteType,
      completed: args.completed,
      displayOrder: args.displayOrder,
    });

    // If this note has a parent, append sub-document link to parent content
    if (args.parentId && !args.skipContentSync) {
      const parentNote = repository.noteQueries.byId(args.parentId as EARS.EntityId);
      if (parentNote) {
        const linkMarkdown = `\n\n[${args.title}](document://${note.id})`;
        const newContent = (parentNote.content || '') + linkMarkdown;
        repository.noteCommands.update(args.parentId as EARS.EntityId, { content: newContent });
      }
    }

    const summary = repository.noteQueries.summary(note.id as EARS.EntityId);
    // Only the window that asked opens it; every window's tree has it through the tree view
    return summary ? { note: summary } : {};
  },
  UPDATE_NOTE: ({ args }) => {
    const noteId = args.id as EARS.EntityId;
    const noteBeforeUpdate = repository.noteQueries.byId(noteId) as NoteEntity | undefined;
    if (!noteBeforeUpdate) throw new Error(`No note ${noteId}`);
    const updates: Record<string, any> = {};

    if (args.title !== undefined) updates.title = args.title;
    if (args.content !== undefined) updates.content = args.content;
    if (args.icon !== undefined) updates.icon = args.icon;
    if (args.hideCompletedChildren !== undefined) updates.hideCompletedChildren = args.hideCompletedChildren;
    if (args.favorite !== undefined) updates.favorite = args.favorite;
    if (args.completed !== undefined) {
      updates.completed = args.completed;
      // When completing: save current displayOrder
      if (args.completed && !noteBeforeUpdate.completed) {
        updates.savedDisplayOrder = noteBeforeUpdate.displayOrder;
      }
    }

    repository.noteCommands.update(noteId, updates);

    // When uncompleting: restore saved position
    // A cleared position is removed, so the note holds none
    if (args.completed === false && noteBeforeUpdate.savedDisplayOrder != null) {
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
      if (args.title !== undefined && updatedNote.parentId) {
        const parentNote = repository.noteQueries.byId(updatedNote.parentId as EARS.EntityId);
        if (parentNote?.content) {
          const linkPattern = new RegExp(
            `\\[([^\\]]*)\\]\\(document:\\/\\/${(noteId as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`,
            'g'
          );
          const newContent = parentNote.content.replace(linkPattern, `[${args.title}](document://${noteId})`);
          if (newContent !== parentNote.content) {
            repository.noteCommands.update(updatedNote.parentId as EARS.EntityId, { content: newContent });
          }
        }
      }
    }
  },
  DELETE_NOTE: ({ args }) => {
    // Get parent before deletion for update
    const noteDTO = repository.noteQueries.byIdDTO(args.id as EARS.EntityId);
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
    const descendantIds = collectDescendants(args.id as EARS.EntityId);

    // Remove link markdown from referencing notes before deletion
    const allDeletedIds = [args.id, ...descendantIds];
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
    repository.noteCommands.softDelete(args.id as EARS.EntityId);
  },
  SOFT_DELETE_NOTE: ({ args }) => { repository.noteCommands.softDelete(args.id as EARS.EntityId); },
  RESTORE_NOTE: ({ args }) => { repository.noteCommands.restore(args.id as EARS.EntityId); },
  MOVE_NOTE: ({ args }) => {
  const newParentId = args.newParentId as EARS.EntityId | null;

    for (const noteId of args.ids) {
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
  REORDER_NOTE: ({ args }) => {
  const noteId = args.id as EARS.EntityId;
  const newParentId = args.newParentId as EARS.EntityId | null;

    // Skip a drop onto itself or into its own subtree
    if (newParentId && wouldNestInItself(noteId, newParentId)) return;
    repository.noteCommands.reorder(noteId, newParentId, args.newIndex);
  },
  PERMANENTLY_DELETE_NOTE: ({ args }) => { repository.noteCommands.delete(args.id as EARS.EntityId); },
  EMPTY_TRASH: () => {
    for (const note of repository.noteQueries.trashedDTOs()) {
      try {
        repository.noteCommands.delete(note.id as EARS.EntityId);
      } catch {
        // Gone already: deleted with its parent, or by another window
      }
    }
  },
  EXPORT_NOTES: ({ args: { directory, format } }) => exportNotes(directory, format),
  IMPORT_NOTES: ({ args: { directory } }) => {
    const result = importNotes(directory);
    if (result.created === 0 && result.errors.length > 0) throw new Error(result.errors.join('\n'));
    return { count: result.created, ...(result.errors.length > 0 ? { errors: result.errors } : {}) };
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
  },
  states: {
    idle: {
      entry: 'cleanupExpiredNotes',
    },
  },
});

const notesEntry = { spec: notesSpec, machine: notesSystem };

export default notesEntry;
