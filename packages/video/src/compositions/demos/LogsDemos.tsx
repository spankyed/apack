import {useCurrentFrame} from 'remotion';
import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {LogsSurface} from '../../agentbuddy-ui/logs/LogsSurface';
import type {LogsSurfaceState} from '../../agentbuddy-ui/logs/logTypes';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {useAppWindowLayout} from '../../film/appWindowLayout';
import {
  logsContextMenuState,
  logsCopiedState,
  logsCombinedContentState,
  logsEmptyState,
  logsFilteredState,
  logsHasMoreState,
  logsNoMatchingState,
  logsSurfaceState,
  logsSurfaceStateForFrame,
} from '../../film/state/logs';

function LogsDemoWindow({state = logsSurfaceState}: {state?: LogsSurfaceState}) {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="logs" breadcrumbs={['LOGS']} composer={false} layout={layout}>
        <LogsSurface state={state} />
      </AppWindow>
    </SurfaceFrame>
  );
}

export const LogsSurfaceDemo = () => {
  const frame = useCurrentFrame();
  return <LogsDemoWindow state={logsSurfaceStateForFrame(frame)} />;
};

export const LogsListDemo = () => <LogsDemoWindow state={logsSurfaceState} />;

export const LogsEmptyDemo = () => <LogsDemoWindow state={logsEmptyState} />;

export const LogsNoMatchingDemo = () => <LogsDemoWindow state={logsNoMatchingState} />;

export const LogsFilteredDemo = () => <LogsDemoWindow state={logsFilteredState} />;

export const LogsContextMenuDemo = () => <LogsDemoWindow state={logsContextMenuState} />;

export const LogsCopiedDemo = () => <LogsDemoWindow state={logsCopiedState} />;

export const LogsCombinedContentDemo = () => <LogsDemoWindow state={logsCombinedContentState} />;

export const LogsHasMoreDemo = () => <LogsDemoWindow state={logsHasMoreState} />;
