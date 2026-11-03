import { create, write, query } from '#generated/ears.ts';
import { EARS } from '#generated/ears.ts';
import { RepositoryError, RepositoryErrorCode } from '@apackdev/sdk/repositories';

import { resolveReferencesTo, syncReferences } from './link-utils.ts';
import type { NoteEntity } from '#features/notes/be/types.ts';

/** Strips the sub-document link to a note from its parent's content */
function removeParentLink(parentId: EARS.EntityId, id: EARS.EntityId): void {
  const parent = query.ids(parentId).ofType(EARS.Entity.Note).pickOne();
  if (parent?.content) {
    const escaped = (id as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const documentPattern = new RegExp(`\\n?\\n?\\\\?\\[([^\\]\\\\]*)\\\\?\\]\\(document:\\/\\/${escaped}(?:\\?[^)]*)?\\)`, 'g');
    const newContent = parent.content.replace(documentPattern, '');
    if (newContent !== parent.content) {
      write(parentId).setMany({ content: newContent });
    }
  }
}

/** Appends a sub-document link to a note to its parent's content; tasks get none */
function appendParentLink(parentId: EARS.EntityId, id: EARS.EntityId, noteType: string): void {
  const parent = query.ids(parentId).ofType(EARS.Entity.Note).pickOne();
  if (parent && noteType !== 'task') {
    const title = query.ids(id).ofType(EARS.Entity.Note).pickOne()?.title ?? 'Untitled';
    const linkMarkdown = `\n\n[${title}](document://${id})`;
    write(parentId).setMany({ content: (parent.content || '') + linkMarkdown });
  }
}

function reparent(id: EARS.EntityId, oldParentId: string | null, newParentId: EARS.EntityId | null, noteType: string): void {
  // Remove old CONTAINS relation and strip sub-document link from old parent content
  if (oldParentId) {
    write(oldParentId as EARS.EntityId).unlink(EARS.RelKind.CONTAINS, id);
    removeParentLink(oldParentId as EARS.EntityId, id);
  }

  // Create new CONTAINS relation and append sub-document link to new parent content
  if (newParentId) {
    write(newParentId).link(EARS.RelKind.CONTAINS, id);
    appendParentLink(newParentId, id, noteType);
  }
}

export const noteCommands = {
  create: (input: {
    title: string;
    content?: string;
    icon?: string | null;
    parentId?: string;
    displayOrder?: number;
    noteType?: 'document' | 'tasklist' | 'task';
    completed?: boolean;
    id?: string;
  }): NoteEntity => {
    if (!input.title?.trim()) {
      throw new RepositoryError('Title is required', RepositoryErrorCode.VALIDATION_ERROR);
    }

    // Calculate displayOrder if not provided
    let displayOrder = input.displayOrder;
    if (displayOrder == null) {
      if (input.parentId) {
        const siblings = query.ids(input.parentId as EARS.EntityId)
          .out(EARS.RelKind.CONTAINS, EARS.Entity.Note)
          .ids();
        displayOrder = siblings.length;
      } else {
        // Count root notes (notes with no parent)
        const rootCount = query(EARS.Entity.Note).unlinkedFrom(EARS.RelKind.CONTAINS).count();
        displayOrder = rootCount;
      }
    } else {
      // Explicit displayOrder: shift existing siblings at/after this index up by 1
      const siblingIds = input.parentId
        ? query.ids(input.parentId as EARS.EntityId).out(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids()
        : query(EARS.Entity.Note).unlinkedFrom(EARS.RelKind.CONTAINS).ids();

      for (const sid of siblingIds) {
        const sib = query.ids(sid as EARS.EntityId).ofType(EARS.Entity.Note).pickOne();
        if (sib && sib.displayOrder >= displayOrder) {
          write(sib.id).setMany({ displayOrder: sib.displayOrder + 1 });
        }
      }
    }

    const note = create(EARS.Entity.Note, {
      title: input.title,
      content: input.content || '',
      icon: input.icon ?? null,
      noteType: input.noteType ?? 'document',
      completed: input.completed ?? false,
      hideCompletedChildren: false,
      displayOrder,
      lastSeen: 0,
      ...(input.id && { id: input.id as EARS.EntityId<'Note'> }),
    }).row();

    // Create parent-child relationship
    if (input.parentId) {
      write(input.parentId as EARS.EntityId).link(EARS.RelKind.CONTAINS, note.id);
    }

    // Index the links this note's text makes, and the links other notes already made to it
    if (input.content) {
      syncReferences(note.id, input.content);
    }
    resolveReferencesTo(note.id);

    return note;
  },

  update: (id: EARS.EntityId, updates: {
    title?: string;
    content?: string;
    icon?: string | null;
    displayOrder?: number;
    savedDisplayOrder?: number | null;
    lastSeen?: number;
    completed?: boolean;
    hideCompletedChildren?: boolean;
    favorite?: boolean;
    noteType?: 'document' | 'tasklist' | 'task';
  }, skipTimestamp?: boolean): void => {
    const existing = query.ids(id).ofType(EARS.Entity.Note).pickOne();
    if (!existing) {
      throw new RepositoryError(`Note ${id} not found`, RepositoryErrorCode.NOT_FOUND);
    }

    const filteredUpdates: Record<string, any> = {};
    if (updates.title !== undefined) filteredUpdates.title = updates.title;
    if (updates.content !== undefined) filteredUpdates.content = updates.content;
    if (updates.icon !== undefined) filteredUpdates.icon = updates.icon;
    if (updates.displayOrder !== undefined) filteredUpdates.displayOrder = updates.displayOrder;
    // A cleared order is no order: the shape holds a number or nothing, so `null` removes the field
    if (updates.savedDisplayOrder != null) filteredUpdates.savedDisplayOrder = updates.savedDisplayOrder;
    if (updates.lastSeen !== undefined) filteredUpdates.lastSeen = updates.lastSeen;
    if (updates.completed !== undefined) filteredUpdates.completed = updates.completed;
    if (updates.hideCompletedChildren !== undefined) filteredUpdates.hideCompletedChildren = updates.hideCompletedChildren;
    if (updates.favorite !== undefined) filteredUpdates.favorite = updates.favorite;
    if (updates.noteType !== undefined) filteredUpdates.noteType = updates.noteType;

    if (Object.keys(filteredUpdates).length > 0) {
      write(id, { touch: !skipTimestamp }).setMany(filteredUpdates);
    }
    if (updates.savedDisplayOrder === null && existing.savedDisplayOrder !== undefined) {
      write(id, { touch: !skipTimestamp }).delete('savedDisplayOrder');
    }

    // Sync REFERENCES relations when content changes
    if (updates.content !== undefined) {
      syncReferences(id, updates.content);
    }

    // A task has no sub-document link in its parent's content; a note that stops being one gets it
    const parentId = query.ids(id).in(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids()[0];
    if (parentId && updates.noteType !== undefined && (updates.noteType === 'task') !== (existing.noteType === 'task')) {
      if (updates.noteType === 'task') removeParentLink(parentId, id);
      else appendParentLink(parentId, id, updates.noteType);
    }
  },

  /** Moves a note and its sub-notes to the trash; returns the ids moved */
  softDelete: (id: EARS.EntityId): string[] => {
    if (!query.ids(id).ofType(EARS.Entity.Note).pickOne()) return [];
    const subtree = (noteId: EARS.EntityId): EARS.EntityId[] =>
      [noteId, ...query.ids(noteId).out(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids().flatMap(subtree)];
    // A note in the trash takes its sub-notes with it; any already there keep when they went
    const ids = subtree(id);
    for (const noteId of ids) write(noteId).trash();
    return ids;
  },

  /** Takes a note and its trashed sub-notes out of the trash; returns the ids restored */
  restore: (id: EARS.EntityId): string[] => {
    if (!query.trashed.ids(id).exists()) return [];
    write(id).restore();
    const restoredIds: string[] = [id];
    // If parent is still in the trash, detach so note restores at root
    const parentIds = query.withTrashed.ids(id).in(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids();
    if (parentIds.length > 0 && query.trashed.ids(parentIds[0]).exists()) {
      write(parentIds[0]).unlink(EARS.RelKind.CONTAINS, id);
    }
    const childIds = query.withTrashed.ids(id).out(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids();
    for (const childId of childIds) {
      restoredIds.push(...noteCommands.restore(childId));
    }
    return restoredIds;
  },

  move: (id: EARS.EntityId, newParentId: EARS.EntityId | null): { oldParentId: string | null } => {
    const note = query.ids(id).ofType(EARS.Entity.Note).pickOne();
    if (!note) {
      throw new RepositoryError(`Note ${id} not found`, RepositoryErrorCode.NOT_FOUND);
    }

    // Find current parent
    const parentIds = query.ids(id).in(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids();
    const oldParentId = parentIds.length > 0 ? parentIds[0] : null;

    // Early return if already has this parent
    if (oldParentId === newParentId) return { oldParentId };

    reparent(id, oldParentId, newParentId, note.noteType);

    if (newParentId) {
      // Update displayOrder to end of new parent's children
      const newSiblings = query.ids(newParentId).out(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids();
      write(id).setMany({ displayOrder: newSiblings.length - 1 });
    } else {
      // Moving to root: calculate root-level displayOrder
      const rootCount = query(EARS.Entity.Note).unlinkedFrom(EARS.RelKind.CONTAINS).count();
      write(id).setMany({ displayOrder: rootCount - 1 });
    }

    return { oldParentId };
  },

  reorder: (id: EARS.EntityId, newParentId: EARS.EntityId | null, newIndex: number): { oldParentId: string | null; affectedIds: string[] } => {
    const note = query.ids(id).ofType(EARS.Entity.Note).pickOne();
    if (!note) {
      throw new RepositoryError(`Note ${id} not found`, RepositoryErrorCode.NOT_FOUND);
    }

    // Find current parent
    const parentIds = query.ids(id).in(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids();
    const oldParentId = parentIds.length > 0 ? parentIds[0] : null;
    const parentChanged = oldParentId !== newParentId;
    const affectedIds: string[] = [];

    // If parent changed, handle reparenting
    if (parentChanged) {
      reparent(id, oldParentId, newParentId, note.noteType);
    }

    // Get siblings under new parent, sorted by displayOrder
    const siblingIds = newParentId
      ? query.ids(newParentId).out(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids()
      : query(EARS.Entity.Note).unlinkedFrom(EARS.RelKind.CONTAINS).ids();

    const siblings = siblingIds
      .map(sid => query.ids(sid as EARS.EntityId).ofType(EARS.Entity.Note).pickOne())
      .filter((n): n is NoteEntity => n !== undefined)
      .sort((a, b) => a.displayOrder - b.displayOrder);

    // Remove the moved note from siblings list
    const filteredSiblings = siblings.filter(s => s.id !== id);

    // Insert at clamped index
    const insertAt = Math.min(newIndex, filteredSiblings.length);
    filteredSiblings.splice(insertAt, 0, note);

    // Re-index all siblings
    for (let i = 0; i < filteredSiblings.length; i++) {
      const sib = filteredSiblings[i];
      if (sib.displayOrder !== i) {
        write(sib.id).setMany({ displayOrder: i });
        affectedIds.push(sib.id);
      }
    }

    // If parent changed, also re-index old parent's remaining children
    if (parentChanged && oldParentId) {
      const oldSiblingIds = query.ids(oldParentId).out(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids();
      const oldSiblings = oldSiblingIds
        .map(sid => query.ids(sid as EARS.EntityId).ofType(EARS.Entity.Note).pickOne())
        .filter((n): n is NoteEntity => n !== undefined)
        .sort((a, b) => a.displayOrder - b.displayOrder);
      for (let i = 0; i < oldSiblings.length; i++) {
        const sib = oldSiblings[i];
        if (sib.displayOrder !== i) {
          write(sib.id).setMany({ displayOrder: i });
          if (!affectedIds.includes(sib.id)) affectedIds.push(sib.id);
        }
      }
    }

    return { oldParentId, affectedIds };
  },

  delete: (id: EARS.EntityId): void => {
    if (!query.withTrashed.ids(id).exists()) {
      throw new RepositoryError(`Note ${id} not found`, RepositoryErrorCode.NOT_FOUND);
    }

    // Recursively delete children first; a note being deleted, and its family, are often in the trash
    const childIds = query.withTrashed.ids(id).out(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids();
    for (const childId of childIds) {
      noteCommands.delete(childId);
    }

    // Remove parent relationship (if any)
    const parentIds = query.withTrashed.ids(id).in(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids();
    for (const parentId of parentIds) {
      write(parentId).unlink(EARS.RelKind.CONTAINS, id);
    }

    // Remove CONTAINS relationships to children (already deleted)
    write(id).unlink(EARS.RelKind.CONTAINS);

    // Clean up REFERENCES relations (outgoing)
    write(id).unlink(EARS.RelKind.REFERENCES);

    // Clean up incoming REFERENCES (other notes pointing to this one)
    const referencingIds = query.withTrashed.ids(id).in(EARS.RelKind.REFERENCES, EARS.Entity.Note).ids();
    for (const refId of referencingIds) {
      write(refId).unlink(EARS.RelKind.REFERENCES, id);
    }

    // Destroy the entity
    write(id).destroy();
  },
} as const;
