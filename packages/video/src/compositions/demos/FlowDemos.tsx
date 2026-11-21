import {useCurrentFrame} from 'remotion';
import {FlowCanvas} from '../../agentbuddy-ui/flows/FlowCanvas';
import {FlowNode} from '../../agentbuddy-ui/flows/FlowNode';
import {FlowNodeForm} from '../../agentbuddy-ui/flows/FlowNodeForm';
import {FlowPalette} from '../../agentbuddy-ui/flows/FlowPalette';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {WorkflowShot} from '../../film/shots/WorkflowShot';
import {flowNodeFormForFrame} from '../../film/state/flowForms';
import {releaseAutomationWorkflow} from '../../film/state/workflow';

export const FlowPaletteDemo = () => (
  <SurfaceFrame>
    <FlowPalette items={releaseAutomationWorkflow.flow.paletteItems} />
  </SurfaceFrame>
);

export const FlowNodeVariantsDemo = () => (
  <SurfaceFrame>
    {releaseAutomationWorkflow.flow.nodes.map(node => <FlowNode key={node.id} node={node} />)}
  </SurfaceFrame>
);

export const FlowCanvasDemo = () => (
  <SurfaceFrame>
    <FlowCanvas state={releaseAutomationWorkflow.flow} />
  </SurfaceFrame>
);

export const FlowNodeFormDemo = () => {
  const frame = useCurrentFrame();
  const form = flowNodeFormForFrame(frame);
  const selectedNodeId = nodeIdForForm(form.nodeKind);
  return (
    <SurfaceFrame>
      <FlowCanvas
        state={{
          ...releaseAutomationWorkflow.flow,
          editingNodeId: selectedNodeId,
          selectedNodeId,
        }}
      />
      <FlowNodeForm state={form} />
    </SurfaceFrame>
  );
};

function nodeIdForForm(kind: ReturnType<typeof flowNodeFormForFrame>['nodeKind']) {
  if (kind === 'flow' || kind === 'listener') return 'listener';
  if (kind === 'switch' || kind === 'create') return 'codex';
  if (kind === 'schedule' || kind === 'fire') return 'keep';
  return 'claude';
}

export const WorkflowSurfaceDemo = () => {
  const frame = useCurrentFrame();
  return (
    <SurfaceFrame>
      <WorkflowShot frame={frame} />
    </SurfaceFrame>
  );
};
