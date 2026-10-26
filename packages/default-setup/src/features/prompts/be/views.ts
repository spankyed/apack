// The prompts feature's views: the list a window shows and the prompt it has open, each run again after every commit
// that changes it and sent to that window alone. A window's surface holds which page and which prompt; the rows are
// these.
import { defineViews } from '@apackdev/sdk/framework';
import { repository } from '#generated/repository.ts';
import type { EARS } from '#generated/ears.ts';

export const promptViews = defineViews({
  /** The first `limit` prompts in `categories` (every category when it's empty), or all of them without a limit */
  list: ({ limit, categories }: { limit: number | null; categories: string[] }) => repository.promptQueries.list(limit, categories),
  /** One prompt, or `null` for one that doesn't exist or is in the trash */
  byId: ({ id }: { id: EARS.EntityId }) => repository.promptQueries.byId(id) ?? null,
});
