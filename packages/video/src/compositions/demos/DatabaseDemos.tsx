import {useCurrentFrame} from 'remotion';
import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {DatabaseGraphCanvas} from '../../agentbuddy-ui/database/DatabaseGraphCanvas';
import {DatabaseSurface} from '../../agentbuddy-ui/database/DatabaseSurface';
import type {DatabaseSurfaceState} from '../../agentbuddy-ui/database/databaseTypes';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {useAppWindowLayout} from '../../film/appWindowLayout';
import {
  databaseBackupExportState,
  databaseBackupImportState,
  databaseAiLoadingState,
  databaseAiPromptState,
  databaseCopiedRowState,
  databaseEmptyArrayState,
  databaseErrorState,
  databaseExamplesState,
  databaseGraphState,
  databaseLoadingState,
  databaseObjectResultState,
  databasePrimitiveArrayState,
  databaseSchemaRefreshingState,
  databaseSchemaNoResultsState,
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

export const DatabaseAiPromptDemo = () => <DatabaseDemoWindow state={databaseAiPromptState} />;

export const DatabaseAiLoadingDemo = () => <DatabaseDemoWindow state={databaseAiLoadingState} />;

export const DatabasePrimitiveArrayDemo = () => <DatabaseDemoWindow state={databasePrimitiveArrayState} />;

export const DatabaseObjectResultDemo = () => <DatabaseDemoWindow state={databaseObjectResultState} />;

export const DatabaseCopiedRowDemo = () => <DatabaseDemoWindow state={databaseCopiedRowState} />;

export const DatabaseSchemaNoResultsDemo = () => <DatabaseDemoWindow state={databaseSchemaNoResultsState} />;

export const DatabaseSchemaRefreshingDemo = () => <DatabaseDemoWindow state={databaseSchemaRefreshingState} />;

export const DatabaseLoadingDemo = () => <DatabaseDemoWindow state={databaseLoadingState} />;

export const DatabaseErrorDemo = () => <DatabaseDemoWindow state={databaseErrorState} />;

export const DatabaseEmptyArrayDemo = () => <DatabaseDemoWindow state={databaseEmptyArrayState} />;

export const DatabaseBackupExportDemo = () => <DatabaseDemoWindow state={databaseBackupExportState} />;

export const DatabaseBackupImportDemo = () => <DatabaseDemoWindow state={databaseBackupImportState} />;

export const DatabaseTraceDemo = () => <DatabaseDemoWindow state={databaseTraceState} />;

export const DatabaseGraphDemo = () => {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="database" breadcrumbs={['DATABASE']} composer={false} layout={layout}>
        <DatabaseGraphCanvas state={databaseGraphState} />
      </AppWindow>
    </SurfaceFrame>
  );
};
