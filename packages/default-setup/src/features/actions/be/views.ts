// The actions feature's views: the list a window shows and the action it has open, each run again after every commit
// that changes it and sent to that window alone. A window's surface holds which page and which action; the rows are
// these. The flows editor reads the whole list for its palette.
import { defineViews } from '@apackdev/sdk/framework';
import { repository } from '#generated/repository.ts';
import type { EARS } from '#generated/ears.ts';

export const actionViews = defineViews({
  /** The first `limit` actions in `categories` (every category when it's empty), or all of them without a limit */
  list: ({ limit, categories }: { limit: number | null; categories: string[] }) => repository.actionQueries.list(limit, categories),
  /** One action, or `null` for one that doesn't exist or is in the trash */
  byId: ({ id }: { id: EARS.EntityId }) => repository.actionQueries.byId(id) ?? null,
});
