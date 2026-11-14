import {LibraryBrowser} from './LibraryBrowser';
import {LibraryDocumentEditor} from './LibraryDocumentEditor';
import type {LibrarySurfaceState} from './libraryTypes';

// Mirrors packages/renderer/src/plugins/library/canvas.vue currentView routing.
export function LibrarySurface({state}: {state: LibrarySurfaceState}) {
  if ((state.currentView === 'create' || state.currentView === 'edit') && state.documentEditor) {
    return <LibraryDocumentEditor state={state.documentEditor} />;
  }

  return <LibraryBrowser state={state} />;
}
