import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {LibraryDocumentEditor} from '../../agentbuddy-ui/library/LibraryDocumentEditor';
import {LibraryPanel} from '../../agentbuddy-ui/library/LibraryPanel';
import {LibrarySurface} from '../../agentbuddy-ui/library/LibrarySurface';
import type {LibrarySurfaceState} from '../../agentbuddy-ui/library/libraryTypes';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {useAppWindowLayout} from '../../film/appWindowLayout';
import {libraryBrokenRowRelinkState, libraryBrokenSymlinkState, libraryBulkSelectionState, libraryDocumentEditorCopiedCodeState, libraryDocumentEditorState, libraryLoadingFolderState, libraryRenameRowState, libraryRowMenuState, librarySurfaceState} from '../../film/state/library';

function LibraryDemoWindow({state = librarySurfaceState}: {state?: LibrarySurfaceState}) {
  const layout = useAppWindowLayout({hasRightRail: true});
  return (
    <SurfaceFrame>
      <AppWindow
        activePlugin="library"
        breadcrumbs={['LIBRARY']}
        composer={false}
        layout={layout}
        rightRail={<LibraryPanel state={state.panel} />}
      >
        <LibrarySurface state={state} />
      </AppWindow>
    </SurfaceFrame>
  );
}

export const LibrarySurfaceDemo = () => <LibraryDemoWindow />;

export const LibraryBrokenSymlinkDemo = () => <LibraryDemoWindow state={libraryBrokenSymlinkState} />;

export const LibraryLoadingFolderDemo = () => <LibraryDemoWindow state={libraryLoadingFolderState} />;

export const LibraryBulkSelectionDemo = () => <LibraryDemoWindow state={libraryBulkSelectionState} />;

export const LibraryRowMenuDemo = () => <LibraryDemoWindow state={libraryRowMenuState} />;

export const LibraryRenameRowDemo = () => <LibraryDemoWindow state={libraryRenameRowState} />;

export const LibraryBrokenRowRelinkDemo = () => <LibraryDemoWindow state={libraryBrokenRowRelinkState} />;

export const LibraryDocumentEditorDemo = () => {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="library" breadcrumbs={['LIBRARY']} composer={false} layout={layout}>
        <LibraryDocumentEditor state={libraryDocumentEditorState} />
      </AppWindow>
    </SurfaceFrame>
  );
};

export const LibraryDocumentEditorCopiedCodeDemo = () => {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="library" breadcrumbs={['LIBRARY']} composer={false} layout={layout}>
        <LibraryDocumentEditor state={libraryDocumentEditorCopiedCodeState} />
      </AppWindow>
    </SurfaceFrame>
  );
};
