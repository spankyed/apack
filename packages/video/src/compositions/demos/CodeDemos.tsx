import {useCurrentFrame} from 'remotion';
import {CodeFeaturePanel} from '../../agentbuddy-ui/code/CodeFeaturePanel';
import {CodeReview} from '../../agentbuddy-ui/code/CodeReview';
import {PullRequestPanel} from '../../agentbuddy-ui/code/PullRequestPanel';
import {SourceControlPanel} from '../../agentbuddy-ui/code/SourceControlPanel';
import {TerminalPanelSection} from '../../agentbuddy-ui/code/TerminalPanelSection';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {CodeShot} from '../../film/shots/CodeShot';
import {codeReviewViewForFrame, codeShotState, expandedTerminalPanelState, sourceControlPanelReviewState} from '../../film/state/code';
import {DemoFramedArea, DemoFramedRightPanel, DemoPanelSlot, DemoTallFramedArea} from '../DemoLayout';

export const CodeReviewDemo = () => {
  const frame = useCurrentFrame();
  return (
    <SurfaceFrame>
      <DemoFramedArea>
        <CodeReview state={codeShotState.review} view={codeReviewViewForFrame(frame)} />
      </DemoFramedArea>
    </SurfaceFrame>
  );
};

export const SourceControlPanelDemo = () => (
  <SurfaceFrame>
    <DemoTallFramedArea>
      <DemoFramedRightPanel width={430}>
        <CodeFeaturePanel terminal={sourceControlPanelReviewState.terminal}>
          <SourceControlPanel state={sourceControlPanelReviewState} view={codeReviewViewForFrame(132)} />
        </CodeFeaturePanel>
      </DemoFramedRightPanel>
    </DemoTallFramedArea>
  </SurfaceFrame>
);

export const PullRequestPanelDemo = () => {
  const frame = useCurrentFrame();
  const sourceFrame = frame < 80 ? 150 : frame < 160 ? 204 : 236;
  const view = codeReviewViewForFrame(sourceFrame);
  return (
    <SurfaceFrame>
      <DemoFramedArea>
        <DemoFramedRightPanel width={340}>
          <PullRequestPanel
            baseDirectory={codeShotState.review.baseDirectory}
            changeCount={codeShotState.review.staged.length + codeShotState.review.changes.length}
            mode={view.prMode}
            publishProgress={view.prPublishProgress}
            state={view.pullRequest}
          />
        </DemoFramedRightPanel>
      </DemoFramedArea>
    </SurfaceFrame>
  );
};

export const PullRequestFilesDemo = () => (
  <SurfaceFrame>
    <DemoFramedArea>
      <DemoFramedRightPanel width={430}>
        <PullRequestPanel
          baseDirectory={codeShotState.review.baseDirectory}
          changeCount={codeShotState.review.staged.length + codeShotState.review.changes.length}
          mode="files"
          publishProgress={1}
          state={{
            ...codeShotState.review.pullRequest,
            branchPublished: true,
          }}
        />
      </DemoFramedRightPanel>
    </DemoFramedArea>
  </SurfaceFrame>
);

export const PullRequestCreateDemo = () => (
  <SurfaceFrame>
    <DemoFramedArea>
      <DemoFramedRightPanel width={430}>
        <PullRequestPanel
          baseDirectory={codeShotState.review.baseDirectory}
          changeCount={codeShotState.review.staged.length + codeShotState.review.changes.length}
          mode="create"
          publishProgress={1}
          state={{
            ...codeShotState.review.pullRequest,
            branchPublished: true,
            createdPr: undefined,
          }}
        />
      </DemoFramedRightPanel>
    </DemoFramedArea>
  </SurfaceFrame>
);

export const PullRequestDetailsDemo = () => (
  <SurfaceFrame>
    <DemoFramedArea>
      <DemoFramedRightPanel width={430}>
        <PullRequestPanel
          baseDirectory={codeShotState.review.baseDirectory}
          changeCount={codeShotState.review.staged.length + codeShotState.review.changes.length}
          mode="details"
          publishProgress={1}
          state={{
            ...codeShotState.review.pullRequest,
            branchPublished: true,
          }}
        />
      </DemoFramedRightPanel>
    </DemoFramedArea>
  </SurfaceFrame>
);

export const TerminalPanelDemo = () => (
  <SurfaceFrame>
    <DemoPanelSlot side="right" width={520}>
      <TerminalPanelSection state={expandedTerminalPanelState} />
    </DemoPanelSlot>
  </SurfaceFrame>
);

export const CodeSurfaceDemo = () => {
  const frame = useCurrentFrame();
  return (
    <SurfaceFrame>
      <CodeShot frame={frame} />
    </SurfaceFrame>
  );
};
