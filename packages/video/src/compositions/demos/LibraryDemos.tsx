import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {LibraryDocumentEditor} from '../../agentbuddy-ui/library/LibraryDocumentEditor';
import {LibraryPanel} from '../../agentbuddy-ui/library/LibraryPanel';
import {LibrarySurface} from '../../agentbuddy-ui/library/LibrarySurface';
import type {LibrarySurfaceState} from '../../agentbuddy-ui/library/libraryTypes';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {useAppWindowLayout} from '../../film/appWindowLayout';
import {libraryDocumentEditorState, librarySurfaceState} from '../../film/state/library';

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
