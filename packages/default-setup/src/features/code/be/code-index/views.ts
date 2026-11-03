// The code index's views: what the search panel shows of it, each run again after a commit that changes its result.
import { defineViews } from '@apackdev/sdk/framework';
import { repository } from '#generated/repository.ts';
import type { EARS } from '#generated/ears.ts';

export const codeIndexViews = defineViews({
  /** Whether a checkout is indexed and how far along it is */
  indexStatus: ({ root }: { root: string }) => repository.codeIndexQueries.status(root),
  /** The symbols a text finds in a checkout */
  symbols: ({ root, text, limit }: { root: string; text: string; limit: number }) => repository.codeIndexQueries.searchSymbols(root, text, limit),
  /** What calls or refers to a symbol, beside what that can't see */
  symbolCallers: ({ symbol }: { symbol: EARS.EntityId }) => repository.codeIndexAnswers.callers(symbol),
  /** What a symbol calls or refers to, beside what that can't see */
  symbolCallees: ({ symbol }: { symbol: EARS.EntityId }) => repository.codeIndexAnswers.callees(symbol),
  /** The definitions most relevant to a file */
  codeMap: ({ root, path, limit }: { root: string; path: string; limit: number }) => repository.codeIndexAnswers.codeMap(root, path, limit),
});
