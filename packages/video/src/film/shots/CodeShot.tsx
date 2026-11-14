import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {CodeReview} from '../../agentbuddy-ui/code/CodeReview';
import {codeShotViewForFrame} from '../state/code';
import {useAppWindowLayout} from '../appWindowLayout';

export function CodeShot({frame, variant}: {frame: number; variant?: 'landscape' | 'square'}) {
  const view = codeShotViewForFrame(frame);
  const layout = useAppWindowLayout({variant});
  return (
    <AppWindow activePlugin="code" breadcrumbs={view.breadcrumbs} composer={view.composer} layout={layout}>
      <CodeReview state={view.review.state} variant={variant} view={view.review.view} />
    </AppWindow>
  );
}
