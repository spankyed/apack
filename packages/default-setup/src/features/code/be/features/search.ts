import { given } from '@apackdev/state';
import type { NormalizeAsks } from '@apackdev/sdk/events';
import { state } from '#generated/state.ts';
import type { SearchAsks } from '../contract.ts';
import { FileSystemRepository } from '../services/filesystem.ts';
import type { SearchOptions } from '../types.ts';

export interface CodeSearchSystemContext {
  baseDirectory: string | null;
  repository: FileSystemRepository | null;
}

export type Event = { type: 'search.UPDATE_BASE_DIRECTORY'; path: string };

type SearchShape = {
  data: CodeSearchSystemContext;
};

export const searchSystem = state<SearchShape, Event, NormalizeAsks<SearchAsks>>()({
  data: {
    baseDirectory: given,
    repository: null,
  },
  run: ({ data }) => (data.baseDirectory ? { data: { repository: new FileSystemRepository(data.baseDirectory) } } : undefined),
  on: {
    'search.UPDATE_BASE_DIRECTORY': ({ path }) => ({
      data: {
        baseDirectory: path,
        repository: new FileSystemRepository(path),
      },
    }),
  },
  answers: {
    /**
     * Answered with every match once the search ends, and told as it goes to whoever asked: how far it is, and each
     * file's matches as they are found. `signal` aborts when they stop waiting, which stops the search
     */
    'search.SEARCH_FILES': async (args, { data, signal, progress }) => {
      const { repository } = data;
      if (!repository) throw new Error('No directory selected. Please select a directory first.');

      const options: SearchOptions = {
        query: args.query,
        path: args.path,
        includePattern: args.includePattern,
        excludePattern: args.excludePattern,
        caseSensitive: args.caseSensitive,
        wholeWord: args.wholeWord,
        useRegex: args.useRegex,
        maxResults: args.maxResults,
      };
      let totalMatches = 0;
      const results = await repository.searchFiles(
        options,
        (filesSearched, totalFiles, currentFile) => progress({ progress: { filesSearched, totalFiles, currentFile } }),
        (result) => {
          totalMatches += result.matches.length;
          progress({ result });
        },
        signal,
      );
      return { results, totalMatches };
    },
  },
});
