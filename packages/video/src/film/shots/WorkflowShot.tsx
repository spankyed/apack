import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {FlowCanvas} from '../../agentbuddy-ui/flows/FlowCanvas';
import {workflowShotViewForFrame} from '../state/workflow';
import {useAppWindowLayout} from '../appWindowLayout';

export function WorkflowShot({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const view = workflowShotViewForFrame(frame);
  const layout = useAppWindowLayout({variant});
  return (
    <AppWindow activePlugin="flows" breadcrumbs={view.breadcrumbs} composer={false} layout={layout}>
      <FlowCanvas state={view.flow} />
    </AppWindow>
  );
}
