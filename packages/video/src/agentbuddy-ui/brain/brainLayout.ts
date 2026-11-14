import type {BrainNodeState} from './brainTypes';

export const brainLayout = {
  horizontalGap: 45,
  nodeHeight: 80,
  nodeWidth: 200,
  rowHeight: 120,
  trackGap: 30,
};

function leafCount(node: BrainNodeState): number {
  if (!node.children?.length) return 1;
  return node.children.reduce((sum, child) => sum + leafCount(child), 0);
}

export function layoutBrainTracks(tracks: BrainNodeState[]) {
  const nodes: Array<BrainNodeState & {x: number; y: number}> = [];
  let trackY = 110;

  const traverse = (node: BrainNodeState, x: number, y: number) => {
    nodes.push({...node, x, y});
    const childX = x + brainLayout.nodeWidth + brainLayout.horizontalGap;

    if (node.children?.length === 1) {
      traverse(node.children[0], childX, y);
    } else if (node.children && node.children.length > 1) {
      const totalLeaves = node.children.reduce((sum, child) => sum + leafCount(child), 0);
      const totalHeight = (totalLeaves - 1) * brainLayout.rowHeight;
      let currentY = y - totalHeight / 2;
      for (const child of node.children) {
        const childLeaves = leafCount(child);
        const childCenterY = currentY + ((childLeaves - 1) * brainLayout.rowHeight) / 2;
        traverse(child, childX, childCenterY);
        currentY += childLeaves * brainLayout.rowHeight;
      }
    }
  };

  for (let i = tracks.length - 1; i >= 0; i -= 1) {
    const track = tracks[i];
    const trackLeaves = leafCount(track);
    const trackHeight = (trackLeaves - 1) * brainLayout.rowHeight + brainLayout.nodeHeight;
    traverse(track, 270, trackY + trackHeight / 2);
    trackY += trackHeight + brainLayout.trackGap;
  }

  return nodes;
}

export function flattenBrainNodes(nodes: BrainNodeState[]): BrainNodeState[] {
  const result: BrainNodeState[] = [];
  const visit = (node: BrainNodeState) => {
    result.push(node);
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  return result;
}
