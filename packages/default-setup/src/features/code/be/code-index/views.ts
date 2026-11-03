// The code index's views: what the search panel shows of it, each run again after a commit that changes its result.
import { defineViews } from '@apackdev/sdk/framework';
import { repository } from '#generated/repository.ts';

export const codeIndexViews = defineViews({
  /** Whether a checkout is indexed and how far along it is */
  indexStatus: ({ root }: { root: string }) => repository.codeIndexQueries.status(root),
  /** The symbols a text finds in a checkout */
  symbols: ({ root, text, limit }: { root: string; text: string; limit: number }) => repository.codeIndexQueries.searchSymbols(root, text, limit),
});
