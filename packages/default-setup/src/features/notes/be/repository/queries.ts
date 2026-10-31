import { query } from '#generated/ears.ts';
import { EARS } from '#generated/ears.ts';

import type { NoteDTO, NoteSummary, RecentNote } from '../types.ts';
import type { NoteEntity } from '#features/notes/be/types.ts';

function toDTO(note: NoteEntity): NoteDTO {
  // Find parent: who CONTAINS this note?
  const parentId = query.ids(note.id).in(EARS.RelKind.CONTAINS, EARS.Entity.Note).first() ?? null;

  // Count children: what does this note CONTAIN?
  const childCount = query.ids(note.id).out(EARS.RelKind.CONTAINS, EARS.Entity.Note).count();

  return {
    id: note.id,
    title: note.title,
    content: note.content,
    icon: note.icon ?? null,
    noteType: note.noteType ?? 'document',
    completed: note.completed ?? false,
    hideCompletedChildren: note.hideCompletedChildren ?? false,
    parentId,
    displayOrder: note.displayOrder,
    savedDisplayOrder: note.savedDisplayOrder ?? null,
    childCount,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    lastSeen: note.lastSeen ?? 0,
    favorite: note.favorite ?? false,
    ...(note.trashedAt ? { trashedAt: note.trashedAt } : {}),
  };
}

/** The fields a summary reads: never `content`, `updatedAt` or `lastSeen`, which typing in a note moves */
const SUMMARY_FIELDS = ['title', 'icon', 'noteType', 'completed', 'hideCompletedChildren', 'displayOrder', 'savedDisplayOrder', 'favorite', 'createdAt', 'trashedAt'] as const;

type SummaryRow = Pick<NoteEntity, 'id' | (typeof SUMMARY_FIELDS)[number]> & { trashedAt?: number };

/** The notes as the tree shows them, each one's parent and child count read for all of them in two reads */
function toSummaries(notes: SummaryRow[]): NoteSummary[] {
  const ids = notes.map((note) => note.id);
  if (!ids.length) return [];
  // A note's parent is the first note that CONTAINS it, its children the notes it CONTAINS, each counted once
  const parents = new Map<string, EARS.EntityId>();
  for (const { source, target } of query.ids(ids).inEdges(EARS.RelKind.CONTAINS, EARS.Entity.Note)) {
    if (source !== target && !parents.has(target)) parents.set(target, source);
  }
  const children = new Map<string, Set<string>>();
  for (const { source, target } of query.ids(ids).outEdges(EARS.RelKind.CONTAINS, EARS.Entity.Note)) {
    if (source !== target) children.set(source, (children.get(source) ?? new Set()).add(target));
  }
  return notes.map((note) => summaryOf(note, parents.get(note.id) ?? null, children.get(note.id)?.size ?? 0));
}

function summaryOf(note: SummaryRow, parentId: EARS.EntityId | null, childCount: number): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    icon: note.icon ?? null,
    noteType: note.noteType ?? 'document',
    completed: note.completed ?? false,
    hideCompletedChildren: note.hideCompletedChildren ?? false,
    parentId,
    displayOrder: note.displayOrder,
    savedDisplayOrder: note.savedDisplayOrder ?? null,
    childCount,
    createdAt: note.createdAt,
    favorite: note.favorite ?? false,
    ...(note.trashedAt ? { trashedAt: note.trashedAt } : {}),
  };
}

export const noteQueries = {
  /** One note as the tree shows it */
  summary: (id: EARS.EntityId): NoteSummary | undefined => {
    const note = query.ids(id).ofType(EARS.Entity.Note).pickOne([...SUMMARY_FIELDS]);
    return note ? toSummaries([note as SummaryRow])[0] : undefined;
  },

  /** Every note as the tree shows it */
  summaries: (): NoteSummary[] => toSummaries(query(EARS.Entity.Note).pick([...SUMMARY_FIELDS]) as SummaryRow[]),

  /** The notes in the trash, as the trash lists them */
  trashedSummaries: (): NoteSummary[] => toSummaries(query.trashed(EARS.Entity.Note).pick([...SUMMARY_FIELDS]) as SummaryRow[]),

  /** The notes whose title holds `text`, ignoring case, as a search lists them */
  search: (text: string): NoteSummary[] => {
    const wanted = text.trim().toLowerCase();
    if (!wanted) return [];
    const notes = query(EARS.Entity.Note).pick([...SUMMARY_FIELDS]) as SummaryRow[];
    return toSummaries(notes.filter((note) => (note.title || '').toLowerCase().includes(wanted)));
  },

  /** What the welcome page lists: the `limit` notes seen last, and the favourites */
  recent: (limit: number): { recent: RecentNote[]; favorites: RecentNote[] } => {
    const notes = query(EARS.Entity.Note).pick(['title', 'icon', 'noteType', 'updatedAt', 'lastSeen', 'favorite']) as Array<Pick<NoteEntity, 'id' | 'title' | 'icon' | 'noteType' | 'updatedAt' | 'lastSeen' | 'favorite'>>;
    const shown = (note: (typeof notes)[number]): RecentNote => ({ id: note.id, title: note.title, icon: note.icon ?? null, noteType: note.noteType ?? 'document', updatedAt: note.updatedAt });
    return {
      recent: notes.filter((note) => (note.lastSeen ?? 0) > 0).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit).map(shown),
      favorites: notes.filter((note) => note.favorite).map(shown),
    };
  },

  byId: (id: EARS.EntityId): NoteEntity | undefined =>
    query.ids(id).ofType(EARS.Entity.Note).pickOne() ?? undefined,

  byIdDTO: (id: EARS.EntityId): NoteDTO | undefined => {
    const note = query.ids(id).ofType(EARS.Entity.Note).pickOne();
    return note ? toDTO(note) : undefined;
  },

  all: (): NoteEntity[] =>
    query(EARS.Entity.Note).pickAll(),

  allDTOs: (): NoteDTO[] => {
    const notes = query(EARS.Entity.Note).pickAll();
    return notes.map(toDTO);
  },

  children: (parentId: EARS.EntityId): NoteDTO[] => {
    const childIds = query.ids(parentId).out(EARS.RelKind.CONTAINS, EARS.Entity.Note).ids();
    return childIds
      .map(id => query.ids(id).ofType(EARS.Entity.Note).pickOne())
      .filter((n): n is NoteEntity => n !== undefined)
      .map(toDTO);
  },

  /** The notes above this one, its root first */
  ancestorChain: (noteId: EARS.EntityId): NoteDTO[] =>
    query.ids(noteId).ancestors(EARS.RelKind.CONTAINS, EARS.Entity.Note).pickAll().reverse().map(toDTO),

  /**
   * The `limit` notes most related to this one by the links between notes, either way: personalized PageRank from
   * it, so a note linked to it, or linked to what it links to, ranks above one a long walk away, and one no walk from
   * it reaches isn't related at all. Most related first, as the tree shows them
   */
  related: (noteId: EARS.EntityId, limit: number): NoteSummary[] => {
    const hits = query(EARS.Entity.Note).rank(EARS.RelKind.REFERENCES, { direction: 'both', seeds: [noteId] }).limit(limit + 1).hits();
    const ids = hits.filter((hit) => hit.id !== noteId && hit.score > 0).slice(0, limit).map((hit) => hit.id);
    return ids.length ? toSummaries(query.ids(ids).ofType(EARS.Entity.Note).pick([...SUMMARY_FIELDS]) as SummaryRow[]) : [];
  },

  /**
   * The `limit` notes most worth adding beside `mentioned` to answer `text`: reciprocal rank fusion of two orders, how
   * much each note matters from the mentioned ones by the links between notes (`related`'s rank, seeded with them all)
   * and how well it matches `text` (the notes' text index), each note's two places added as 1 / (60 + place), the
   * constant the method was published with. A note in either order may be chosen; the mentioned ones never are
   */
  relatedToAll: (mentioned: readonly EARS.EntityId[], text: string, limit: number): EARS.EntityId[] => {
    const exclude = new Set<string>(mentioned);
    const candidates = 50;
    const linked = mentioned.length
      ? query(EARS.Entity.Note).rank(EARS.RelKind.REFERENCES, { direction: 'both', seeds: mentioned })
        .limit(candidates + mentioned.length).hits().filter((hit) => hit.score > 0).map((hit) => hit.id)
      : [];
    const matched = text.trim() ? query(EARS.Entity.Note).search(text).limit(candidates + mentioned.length).ids() : [];
    const fused = new Map<EARS.EntityId, number>();
    for (const order of [linked, matched]) {
      order.filter((id) => !exclude.has(id)).forEach((id, place) => fused.set(id, (fused.get(id) ?? 0) + 1 / (60 + place)));
    }
    // Stable: of two scored alike, the one placed first by the links
    return [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  },

  referencedBy: (noteId: EARS.EntityId): EARS.EntityId[] =>
    query.ids(noteId).in(EARS.RelKind.REFERENCES, EARS.Entity.Note).ids(),

  trashedDTOs: (): NoteDTO[] => (query.trashed(EARS.Entity.Note).pickAll() as NoteEntity[]).map(toDTO),

  expiredSoftDeleted: (maxAgeDays: number): NoteEntity[] =>
    query.trashed(EARS.Entity.Note)
      .where('trashedAt', (at) => typeof at === 'number' && at < Date.now() - maxAgeDays * 24 * 60 * 60 * 1000)
      .pickAll() as NoteEntity[],

} as const;
