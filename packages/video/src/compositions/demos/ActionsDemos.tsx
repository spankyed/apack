import {useCurrentFrame} from 'remotion';
import {ActionsSurface} from '../../agentbuddy-ui/actions/ActionsSurface';
import type {ActionsSurfaceState} from '../../agentbuddy-ui/actions/actionTypes';
import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {useAppWindowLayout} from '../../film/appWindowLayout';
import {
  actionCreateState,
  actionCollapsedSectionsState,
  actionDetailState,
  actionsEmptyState,
  actionsFilteredState,
  actionsListState,
  actionsLoadingMoreState,
  actionsSurfaceStateForFrame,
} from '../../film/state/actions';

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

export const ActionsEmptyDemo = () => <ActionsDemoWindow state={actionsEmptyState} />;

export const ActionsFilteredDemo = () => <ActionsDemoWindow state={actionsFilteredState} />;

export const ActionsLoadingMoreDemo = () => <ActionsDemoWindow state={actionsLoadingMoreState} />;

export const ActionCreateDemo = () => <ActionsDemoWindow state={actionCreateState} />;

export const ActionDetailDemo = () => <ActionsDemoWindow state={actionDetailState} />;

export const ActionCollapsedSectionsDemo = () => <ActionsDemoWindow state={actionCollapsedSectionsState} />;

export const ActionsSurfaceDemo = () => {
  const frame = useCurrentFrame();
  return <ActionsDemoWindow state={actionsSurfaceStateForFrame(frame)} />;
};
