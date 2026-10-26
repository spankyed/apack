<template>
  <div class="h-full flex flex-col">
    <FolderReader v-for="folderId in shownFolders" :key="folderId ?? ''" :folder-id="folderId" />
    <div v-if="context.writeError" class="flex items-center justify-between gap-2 px-3 py-2 text-sm text-red-400 bg-red-500/10 border-b border-red-500/20">
      <span>{{ context.writeError }}</span>
      <button type="button" class="text-xs opacity-70 hover:opacity-100" @click="send({ type: 'CLEAR_WRITE_ERROR' })">Dismiss</button>
    </div>
    <component
      v-if="currentComponent"
      :key="context.currentView === 'edit' ? context.editingDocumentId : context.currentView"
      class="flex-1 min-h-0"
      :is="currentComponent"
      v-bind="currentProps"
      v-on="currentEvents"
    />
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { computed, watch } from 'vue'
import { useSelector } from '@xstate/vue'
import { useView } from '#generated/fe.ts'
import FolderReader from './components/FolderReader.vue'
import type { LibraryEvents } from './state.ts'
import DocumentEditor from './components/DocumentEditor.vue'
// [SEARCH_INDEX_FF] import CreateIndexView from './components/search-index/CreateIndexView.vue'
// [SEARCH_INDEX_FF] import TestIndexView from './components/search-index/TestIndexView.vue'
import FileSystemBrowser from './components/FileSystemBrowser.vue'
import type { LibraryActor } from './state.ts'

const actor: LibraryActor = useSurface()
const context = useSelector(actor, (state) => state.context)
const send = (event: LibraryEvents) => actor.send(event)

// The folder open and each one expanded, each watched by its own reader
const shownFolders = computed(() => [...new Set([context.value.currentFolderId, ...context.value.expandedFolderIds])])
// The document open in the editor, and every document's name and tags
const editing = useView('library', 'document', () => (context.value.currentView === 'edit' && context.value.editingDocumentId ? { id: context.value.editingDocumentId } : null))
watch(() => editing.data, (document) => {
  const documentId = context.value.editingDocumentId
  if (document && documentId) send({ type: 'DOCUMENT.READ', documentId, document })
})
const index = useView('library', 'index')
watch(() => index.data, (data) => { if (data) send({ type: 'INDEX.READ', index: data }) }, { immediate: true })

const currentComponent = computed(() => {
  switch (context.value.currentView) {
    case 'create':
      return DocumentEditor
    // The editor takes its document once, when it opens, so it waits for the document to arrive
    case 'edit':
      return context.value.editingDocument ? DocumentEditor : null
    // [SEARCH_INDEX_FF] search index views — commented out
    // case 'create-index': return CreateIndexView
    // case 'edit-index': return CreateIndexView
    // case 'test-index': return TestIndexView
    case 'browser':
    default:
      return FileSystemBrowser
  }
})

const currentProps = computed(() => {
  const base = {
    selectedCollectionId: context.value.currentFolderId ?? undefined,
  }
  
  switch (context.value.currentView) {
    case 'browser':
      return {
        items: context.value.items,
        currentPath: context.value.currentPath,
        selectedItems: context.value.selectedItems,
        sortBy: context.value.sortBy,
        sortDirection: context.value.sortDirection,
        currentFolderId: context.value.currentFolderId,
        breadcrumbs: context.value.breadcrumbs,
        itemToEdit: context.value.itemToEdit,
        expandedFolderIds: context.value.expandedFolderIds,
        expandedFolderChildren: context.value.expandedFolderChildren,
        loadingFolderIds: context.value.loadingFolderIds,
        isInSymlinkContext: context.value.isInSymlinkContext,
        currentSymlinkRootId: context.value.currentSymlinkRootId,
        symlinkBasePath: context.value.symlinkBasePath,
        isBroken: context.value.isBroken,
        lastKnownPath: context.value.lastKnownPath,
      }
    case 'create':
      return {
        ...base,
      }
    case 'edit':
      return {
        ...base,
        document: context.value.editingDocument,
      }
    // [SEARCH_INDEX_FF] search index props — commented out
    // case 'create-index': return {}
    // case 'edit-index': return { editMode: true, initialData: context.value.editingIndex }
    default:
      return base
  }
})

const currentEvents = computed(() => {
  const coreEvents = {
    // Document management
    CREATE_DOCUMENT: () => send({ type: 'CREATE_DOCUMENT' }),
    EDIT_DOCUMENT: (payload: { documentId: string }) => send({ type: 'EDIT_DOCUMENT', ...payload }),
    DELETE_DOCUMENT: (payload: { documentId: string }) => send({ type: 'DELETE_DOCUMENT', ...payload }),
    SAVE_DOCUMENT: (payload: { name: string; content: any; tags: string[]; collectionId?: string }) =>
      send({ type: 'SAVE_DOCUMENT', ...payload }),
    CANCEL_EDIT: () => send({ type: 'CANCEL_EDIT' }),
    
    // [SEARCH_INDEX_FF] Search index management — commented out
    // CREATE_SEARCH_INDEX: () => send({ type: 'CREATE_SEARCH_INDEX' }),
    // SAVE_SEARCH_INDEX: (config: any) => send({ type: 'SAVE_SEARCH_INDEX', config }),
    // CANCEL_CREATE_INDEX: () => send({ type: 'CANCEL_CREATE_INDEX' }),
    // EDIT_SEARCH_INDEX: (payload: { indexId: string }) => send({ type: 'EDIT_SEARCH_INDEX', ...payload }),
    // UPDATE_SEARCH_INDEX: (payload: { indexId: string; config: any }) => send({ type: 'UPDATE_SEARCH_INDEX', ...payload }),
    // DELETE_SEARCH_INDEX: (payload: { indexId: string }) => send({ type: 'DELETE_SEARCH_INDEX', ...payload }),
    // CANCEL_EDIT_INDEX: () => send({ type: 'CANCEL_EDIT_INDEX' }),

    CREATE_COLLECTION: (payload: { name: string; description?: string; parentId?: string }) =>
      send({ type: 'CREATE_COLLECTION', ...payload }),
    
    // Navigation
    TRAIL_CLICK: (payload: { trail: string[] }) =>
      send({ type: 'TRAIL_CLICK', ...payload }),
  }

  const fileBrowserEvents = {
    NAVIGATE_TO_FOLDER: (payload: { folderId: string | null }) => 
      send({ type: 'NAVIGATE_TO_FOLDER', ...payload }),
    DOUBLE_CLICK_ITEM: (payload: { item: any }) => 
      send({ type: 'DOUBLE_CLICK_ITEM', ...payload }),
    SELECT_ITEMS: (payload: { itemIds: string[] }) => 
      send({ type: 'SELECT_ITEMS', ...payload }),
    SORT_BY: (payload: { column: 'name' | 'modified' | 'size' | 'kind' }) => 
      send({ type: 'SORT_BY', ...payload }),
    CREATE_FOLDER: (payload: { name: string }) => 
      send({ type: 'CREATE_FOLDER', ...payload }),
    RENAME_ITEM: (payload: { itemId: string; name: string }) => 
      send({ type: 'RENAME_ITEM', ...payload }),
    DELETE_SELECTED_ITEMS: () => 
      send({ type: 'DELETE_SELECTED_ITEMS' }),
    BREADCRUMB_CLICK: (payload: { folderId: string | null }) =>
      send({ type: 'BREADCRUMB_CLICK', ...payload }),
    START_EDITING_ITEM: () => {
      // Clear the itemToEdit flag once editing has started
      send({ type: 'CLEAR_ITEM_TO_EDIT' })
    },
    MOVE_ITEMS: (payload: { itemIds: string[]; targetFolderId: string | null }) => {
      send({ type: 'MOVE_ITEMS', ...payload })
    },
    EXPAND_FOLDER: (payload: { folderId: string }) => {
      send({ type: 'EXPAND_FOLDER', ...payload })
    },
    COLLAPSE_FOLDER: (payload: { folderId: string }) => {
      send({ type: 'COLLAPSE_FOLDER', ...payload })
    },
    CREATE_SYMLINK: (payload: { symlinkPath: string }) => {
      send({ type: 'CREATE_SYMLINK', ...payload })
    },
    REFRESH_FOLDER: (payload: { folderId: string }) => {
      send({ type: 'REFRESH_FOLDER', ...payload })
    },
    RELINK_SYMLINK: (payload: { collectionId: string; newPath: string }) => {
      send({ type: 'RELINK_SYMLINK', ...payload })
    },
    REMOVE_BROKEN_SYMLINK: (payload: { collectionId: string }) => {
      send({ type: 'REMOVE_BROKEN_SYMLINK', ...payload })
      send({ type: 'NAVIGATE_TO_FOLDER', folderId: null })
    },
  }

  return {
    ...coreEvents,
    ...fileBrowserEvents,
  }
})
</script>