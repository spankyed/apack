import {AppWindow} from '../../../agentbuddy-ui/chrome/AppWindow';
import {FlowCanvas} from '../../../agentbuddy-ui/flows/FlowCanvas';
import {workflowShotViewForFrame} from '../../state/workflow';
import {useAppWindowLayout} from '../../appWindowLayout';
import '../../shots/WorkflowShot.module.css';
import {makeStyles} from '../../../agentbuddy-ui/primitives/makeStyles';

const styles = makeStyles('WorkflowShot');

// Backdrop, window frame, chrome, palette, and controls are all pinned to
// their settled state; only the nodes appearing and edges drawing animate.
// The timeline EDL skips the source shot's chrome-reveal beats entirely.
export function SimpleWorkflowScene({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const view = workflowShotViewForFrame(frame);
  const layout = useAppWindowLayout({animate: false, variant});
  const flow = {...view.flow, chrome: undefined};

  return (
    <div className={styles.root}>
      <div className={styles.appReveal}>
        <AppWindow
          activePlugin="flows"
          breadcrumbs={view.breadcrumbs}
          composer={false}
          layout={layout}
        >
          <div style={{height: '100%'}}>
            <FlowCanvas backgroundOpacity={1} state={flow} />
          </div>
        </AppWindow>
      </div>
    </div>
  );
}
