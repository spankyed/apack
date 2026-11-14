import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {BrainSurface} from '../../agentbuddy-ui/brain/BrainSurface';
import type {BrainSurfaceState} from '../../agentbuddy-ui/brain/brainTypes';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {useAppWindowLayout} from '../../film/appWindowLayout';
import {brainPausedState, brainStoppedState, brainSurfaceState} from '../../film/state/brain';

function BrainDemoWindow({state}: {state: BrainSurfaceState}) {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="brain" breadcrumbs={['BRAIN']} composer={false} layout={layout}>
        <BrainSurface state={state} />
      </AppWindow>
    </SurfaceFrame>
  );
}

export const BrainSurfaceDemo = () => <BrainDemoWindow state={brainSurfaceState} />;

export const BrainPausedDemo = () => <BrainDemoWindow state={brainPausedState} />;

export const BrainStoppedDemo = () => <BrainDemoWindow state={brainStoppedState} />;
