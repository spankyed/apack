// The notes feature's views, each run again after every commit that changes it and sent to the window that asked. The
// tree reads no note's text, so typing in a note re-runs only the views showing that note; the surface edits its copy
// of the tree and of the open note at once and holds their results behind its unanswered writes (`fe/state.ts`).
import { defineViews } from '@apackdev/sdk/framework';
import { repository } from '#generated/repository.ts';
import type { EARS } from '#generated/ears.ts';

export const noteViews = defineViews({
  /** Every note as the tree shows it */
  tree: () => repository.noteQueries.summaries(),
  /** One note with its text, or `null` for one that doesn't exist or is in the trash */
  note: ({ id }: { id: EARS.EntityId }) => repository.noteQueries.byIdDTO(id) ?? null,
  /** What the welcome page lists: the `limit` notes seen last, and the favourites */
  recent: ({ limit }: { limit: number }) => repository.noteQueries.recent(limit),
  /** The `limit` notes most related to one by the links between notes, most related first */
  related: ({ id, limit }: { id: EARS.EntityId; limit: number }) => repository.noteQueries.related(id, limit),
  /** The notes whose title holds `text` */
  search: ({ text }: { text: string }) => repository.noteQueries.search(text),
  /** The notes in the trash */
  trash: () => repository.noteQueries.trashedSummaries(),
});
