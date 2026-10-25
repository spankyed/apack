import { findRelations } from '@apackdev/sdk/ears';
import { write, query } from '#generated/ears.ts';
import { EARS } from '#generated/ears.ts';

import { parseReferenceHref } from '@apackdev/sdk/framework';
import { NOTE_TYPE_TO_REFERENCE_TYPE } from '../../reference-types.ts';


/**
 * Extract canonical note, task and task-list targets from internal Markdown references.
 */
export function parseNoteLinks(content: string): EARS.EntityId[] {
  const pattern = /\[(?:\\.|[^\]\\])*\]\((apack-ref:\/\/[^)\s]+)\)/g;
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const target = parseReferenceHref(match[1]);
    if (target && Object.values(NOTE_TYPE_TO_REFERENCE_TYPE).includes(target.type)) ids.add(target.id);
  }
  return [...ids] as EARS.EntityId[];
}

/**
 * A note's links, derived from its text, in two forms: `linkTargets`, every note id its links name, which the value
 * index answers "who links to this note?" from (`resolveReferencesTo`); and its REFERENCES, one relation per named
 * note that exists, in the trash or not. Neither is ever the only record of a link — the text is — so rebuilding
 * both from the text loses nothing, and a link to a note that doesn't exist (yet) is a target until it does.
 */
export function syncReferences(sourceId: EARS.EntityId, content: string): void {
  const targets = parseNoteLinks(content).filter((id) => id !== sourceId);
  const stored = (query.withTrashed.ids(sourceId).pickOne(['linkTargets'])?.linkTargets ?? []) as string[];
  if (targets.length === 0) {
    if (stored.length > 0) write(sourceId).delete('linkTargets');
  } else if (targets.length !== stored.length || targets.some((id, i) => id !== stored[i])) {
    write(sourceId).set('linkTargets', targets);
  }

  const wanted = new Set(targets.filter((id) => query.withTrashed.ids(id).exists()));
  // Every REFERENCES relation the note has, one to a note that is gone included, so a stale one is removed too
  const current = new Set(findRelations({ source: sourceId, kind: EARS.RelKind.REFERENCES }).map((r) => r.target as EARS.EntityId));

  for (const targetId of wanted) {
    // `references` is unique: one edge to each target
    if (!current.has(targetId)) write(sourceId).link(EARS.RelKind.REFERENCES, targetId);
  }
  for (const targetId of current) {
    if (!wanted.has(targetId)) write(sourceId).unlink(EARS.RelKind.REFERENCES, targetId);
  }
}

/** Indexes the links other notes' text already makes to a note that has just been created, found through the value index */
export function resolveReferencesTo(noteId: EARS.EntityId): void {
  for (const note of query.withTrashed(EARS.Entity.Note).where('linkTargets', noteId).pick(['content'])) {
    syncReferences(note.id as EARS.EntityId, note.content as string);
  }
}
