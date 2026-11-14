import {useCurrentFrame} from 'remotion';
import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {DatabaseSurface} from '../../agentbuddy-ui/database/DatabaseSurface';
import type {DatabaseSurfaceState} from '../../agentbuddy-ui/database/databaseTypes';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {useAppWindowLayout} from '../../film/appWindowLayout';
import {
  databaseBackupExportState,
  databaseBackupImportState,
  databaseExamplesState,
  databaseSurfaceState,
  databaseSurfaceStateForFrame,
  databaseTraceState,
} from '../../film/state/database';

function DatabaseDemoWindow({state = databaseSurfaceState}: {state?: DatabaseSurfaceState}) {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="database" breadcrumbs={['DATABASE']} composer={false} layout={layout}>
        <DatabaseSurface state={state} />
      </AppWindow>
    </SurfaceFrame>
  );
}

export const DatabaseSurfaceDemo = () => {
  const frame = useCurrentFrame();
  return <DatabaseDemoWindow state={databaseSurfaceStateForFrame(frame)} />;
};

export const DatabaseQueryDemo = () => <DatabaseDemoWindow state={databaseSurfaceState} />;

export const DatabaseExamplesDemo = () => <DatabaseDemoWindow state={databaseExamplesState} />;

export const DatabaseBackupExportDemo = () => <DatabaseDemoWindow state={databaseBackupExportState} />;

export const DatabaseBackupImportDemo = () => <DatabaseDemoWindow state={databaseBackupImportState} />;

export const DatabaseTraceDemo = () => <DatabaseDemoWindow state={databaseTraceState} />;
