import {useCurrentFrame} from 'remotion';
import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {LogsSurface} from '../../agentbuddy-ui/logs/LogsSurface';
import type {LogsSurfaceState} from '../../agentbuddy-ui/logs/logTypes';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {useAppWindowLayout} from '../../film/appWindowLayout';
import {logsFilteredState, logsSurfaceState, logsSurfaceStateForFrame} from '../../film/state/logs';

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

export const LogsFilteredDemo = () => <LogsDemoWindow state={logsFilteredState} />;
