import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {useAppWindowLayout} from '../../film/appWindowLayout';
import {codeShotState} from '../../film/state/code';

export const ToolbarDemo = () => {
  const layout = useAppWindowLayout({});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="code" breadcrumbs={codeShotState.chromeDemoBreadcrumbs} composer={false} layout={layout}>
        <div />
      </AppWindow>
    </SurfaceFrame>
  );
};
