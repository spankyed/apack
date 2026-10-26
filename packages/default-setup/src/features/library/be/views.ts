// The library's views: what it stores, each run again after every commit that changes it and sent to the window that
// asked. A symlinked folder's contents and its files are on disk, which no view can watch — a view reads the engine
// and nothing else — so those views say so (`onDisk`) and the window fetches them (`GET_FOLDER_CONTENTS`,
// `GET_DOCUMENT`), fetching again when the system says a folder on disk changed (`FOLDER_CHANGED`).
import { defineViews } from '@apackdev/sdk/framework';
import { repository } from '#generated/repository.ts';
import type { EARS } from '#generated/ears.ts';
import type { DocumentView, FolderView } from './types.ts';

export const libraryViews = defineViews({
  /** Every document and folder by name: what the reference picker offers and the panel counts */
  index: () => repository.libraryQueries.getIndex(),
  /** A folder's contents as the library stores them, or that they are on disk */
  folder: ({ folderId }: { folderId: string | null }): FolderView => (repository.libraryQueries.isDiskFolder(folderId)
    ? { onDisk: true }
    : { onDisk: false, contents: repository.libraryQueries.engineFolderContents(folderId as EARS.EntityId | null) }),
  /** A document as the library stores it, `null` once it's gone, or that it is a file on disk */
  document: ({ id }: { id: string }): DocumentView => (repository.libraryQueries.isDiskDocument(id)
    ? { onDisk: true }
    : { onDisk: false, document: repository.libraryQueries.findDocument(id as EARS.EntityId) }),
});
