import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {BrowserSurface} from '../../agentbuddy-ui/browser';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {useAppWindowLayout} from '../../film/appWindowLayout';
import {browserSurfaceState, browserSurfaceStateForFrame} from '../../film/state/browser';

export const BrowserSurfaceDemo = () => {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="browser" breadcrumbs={['BROWSER']} composer={false} layout={layout}>
        <BrowserSurface state={browserSurfaceState} />
      </AppWindow>
    </SurfaceFrame>
  );
};

export const BrowserAutocompleteDemo = () => {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="browser" breadcrumbs={['BROWSER']} composer={false} layout={layout}>
        <BrowserSurface state={browserSurfaceStateForFrame(276)} />
      </AppWindow>
    </SurfaceFrame>
  );
};
