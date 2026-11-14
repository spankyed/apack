import {useCurrentFrame} from 'remotion';
import {ActionsSurface} from '../../agentbuddy-ui/actions/ActionsSurface';
import type {ActionsSurfaceState} from '../../agentbuddy-ui/actions/actionTypes';
import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {useAppWindowLayout} from '../../film/appWindowLayout';
import {actionDetailState, actionsListState, actionsSurfaceStateForFrame} from '../../film/state/actions';

function ActionsDemoWindow({state = actionsListState}: {state?: ActionsSurfaceState}) {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="actions" breadcrumbs={['ACTIONS']} composer={false} layout={layout}>
        <ActionsSurface state={state} />
      </AppWindow>
    </SurfaceFrame>
  );
}

export const ActionsListDemo = () => <ActionsDemoWindow state={actionsListState} />;

export const ActionDetailDemo = () => <ActionsDemoWindow state={actionDetailState} />;

export const ActionsSurfaceDemo = () => {
  const frame = useCurrentFrame();
  return <ActionsDemoWindow state={actionsSurfaceStateForFrame(frame)} />;
};
