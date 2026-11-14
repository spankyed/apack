import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {FlowCanvas} from '../../agentbuddy-ui/flows/FlowCanvas';
import {workflowBeats, workflowShotViewForFrame} from '../state/workflow';
import {useAppWindowLayout} from '../appWindowLayout';
import {ease} from '../state/timeline';
import './WorkflowShot.module.css';
import {makeStyles} from '../../agentbuddy-ui/primitives/makeStyles';

const styles = makeStyles('WorkflowShot');

export function WorkflowShot({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const view = workflowShotViewForFrame(frame);
  const layout = useAppWindowLayout({variant});
  const backdropReveal = ease(frame, workflowBeats.backdrop.from, workflowBeats.backdrop.to);
  const frameReveal = ease(frame, workflowBeats.appFrame.from, workflowBeats.appFrame.to);
  const chromeReveal = ease(frame, workflowBeats.chrome.from, workflowBeats.chrome.to);

  return (
    <div className={styles.root}>
      <div className={styles.appReveal}>
        <AppWindow
          activePlugin="flows"
          breadcrumbs={view.breadcrumbs}
          chromeOpacity={chromeReveal}
          composer={false}
          frameOpacity={frameReveal}
          headerOpacity={chromeReveal}
          layout={layout}
        >
          <div style={{height: '100%'}}>
            <FlowCanvas backgroundOpacity={backdropReveal} state={view.flow} />
          </div>
        </AppWindow>
      </div>
    </div>
  );
}
