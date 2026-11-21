import {LibraryBrowser} from './LibraryBrowser';
import type {LibrarySurfaceState} from './libraryTypes';

export function LibrarySurface({state}: {state: LibrarySurfaceState}) {
  return <LibraryBrowser state={state} />;
}
