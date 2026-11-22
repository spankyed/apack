<template>
  <div ref="canvasRoot" class="relative w-full h-full">
    <VueFlow
      :nodes="nodes"
      :edges="edges"
      class="w-full h-full bg-neutral-900"
      data-onboarding-id="brain-flow-graph"
      :fit-view-on-init="true"
      :connection-line-type="ConnectionLineType.SmoothStep"
      :default-edge-options="{
        type: 'smoothstep',
        style: { strokeWidth: 2 },
        markerEnd: MarkerType.Arrow
      }"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :zoom-on-scroll="true"
      :pan-on-scroll="false"
      :zoom-on-double-click="false"
      :min-zoom="0.5"
      :max-zoom="2"
    >
      <template #node-run-node="nodeProps">
        <BaseNode
          v-bind="nodeProps"
          :editable="false"
          :show-status-indicator="nodeProps.data.kind !== 'event'"
          :selectable="nodeProps.data.kind === 'flow' || nodeProps.data.kind === 'step' || nodeProps.data.kind === 'event'"
        />
      </template>
      <Background variant="dots" />
      <Controls />
      
      <!-- Back button (top left) -->
      <div v-if="canGoBack" class="absolute z-10 top-4 left-4">
        <button
          class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-all duration-200 rounded-md bg-neutral-900/90 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 hover:text-neutral-100 backdrop-blur-sm"
          @click="$emit('back-click')"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      </div>
      
      <!-- Fit button (bottom left) -->
      <div class="absolute z-10 bottom-4 left-4 flex gap-2">
        <!-- Fit to View Button -->
        <button
          class="flex items-center justify-center p-1.5 text-sm rounded-md bg-neutral-900/90 border border-neutral-800 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition-all backdrop-blur-sm"
          title="Jump to latest"
          @click="panToLatestTrack"
        >
          <Maximize :size="16" />
        </button>
      </div>
      
      <!-- Current RunNode label (top center) -->
      <div v-if="flowRunNodeId" class="absolute z-10 transform -translate-x-1/2 left-1/2 top-4">
        <div class="px-4 py-2 border rounded-md bg-neutral-900/90 border-neutral-800 backdrop-blur-sm">
          <span class="text-sm text-neutral-100">{{ flowRunNodeId }}</span>
        </div>
      </div>
    </VueFlow>
  </div>
</template>

<script lang="ts">
export default {
  name: 'RunNodeGraph'
}
</script>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import {
  VueFlow,
  ConnectionLineType,
  MarkerType,
  type Node as VueFlowNode,
  type Edge,
  type NodeMouseEvent,
  useVueFlow,
} from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import type { RunTree } from '@apackdev/sdk/steps';
import BaseNode from '@apackdev/ui/components/BaseNode';
import { Maximize } from 'lucide-vue-next';
import { useNodeViewport } from '../useNodeViewport.ts';
import { cronToHuman } from '@apackdev/sdk/cron';
import { useStepDeclarations } from '@apackdev/sdk/fe';

const stepDeclarations = useStepDeclarations();

interface Props {
  runNodeTree?: readonly RunTree[];
  flowRunNodeId?: string;
  canGoBack: boolean;
  animationsEnabled?: boolean;
  selectedNodeId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'node-click': [runNodeId: string];
  'flow-navigate': [runNodeId: string];
  'back-click': [];
}>();

// Constants
const LAYOUT = {
  HORIZONTAL_GAP: 45,   // Reduced by 2/3 (was 250)
  VERTICAL_GAP: 40,     // Between sibling nodes in parallel branches
  TRACK_GAP: 30,        // Between separate tracks (like flow surface's chainGap)
  NODE_WIDTH: 200,
  NODE_HEIGHT: 80,
} as const;

const ANIMATION = {
  DURATION: 800,
  MAX_RETRY_ATTEMPTS: 2,
  RETRY_DELAY: 16, // ~1 frame at 60fps
} as const;

const ROW_HEIGHT = LAYOUT.NODE_HEIGHT + LAYOUT.VERTICAL_GAP;

// Vue Flow composables
const {
  setCenter,
  getNode,
  getViewport,
  onNodeClick,
  onNodeDoubleClick
} = useVueFlow();
const { centerNodeInView } = useNodeViewport();

// Click handling state - need to delay single clicks for flow nodes
let clickTimeout: NodeJS.Timeout | null = null;
const DOUBLE_CLICK_DELAY = 250; // ms to wait for double click

// State
let previousNodeIds = new Set<string>();
let animationController: AbortController | null = null;

// Outer wrapper ref — used to catch re-entry into the canvas so we can
// clear any stale middle-mouse pan state (see clearStalePan below).
const canvasRoot = ref<HTMLElement | null>(null);

// Workaround for a "stuck pan" bug: Vue Flow's d3-zoom attaches mouseup
// on window when a drag begins, but if the user releases the mouse
// outside the Electron window (e.g. over another application) the OS
// never delivers that mouseup. The drag's mousemove listener stays live
// and re-entering the canvas resumes panning with no button held. On
// re-entry with no buttons pressed, synthesise a mouseup on window so
// d3-zoom tears down its listeners — and also strip the `.dragging`
// class from the pane, since Vue Flow's end-of-drag cursor state isn't
// always cleared by the synthetic event alone.
const clearStalePan = (event: MouseEvent) => {
  if (event.buttons !== 0) return;
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 1, buttons: 0 }));
  canvasRoot.value?.querySelector('.vue-flow__pane')?.classList.remove('dragging');
};

// Helper functions
const createVueFlowNode = (runNode: RunTree, position: { x: number; y: number }): VueFlowNode => {
  const isTrigger = stepDeclarations.value.some(entry => entry.type === runNode.triggerType && entry.declaration.kind === 'trigger');
  return {
    id: runNode.id,
    type: 'run-node',
    position,
    data: {
      label: runNode.label,
      nodeType: isTrigger ? runNode.triggerType : (runNode.stepNodeType || runNode.kind),
      kind: runNode.kind,
      status: runNode.status,
      eventType: runNode.eventType,
      subtitle: isTrigger && runNode.cronExpression ? cronToHuman(runNode.cronExpression) : runNode.eventType,
    },
  };
};

const subtreeLeafCount = (runNode: RunTree): number => {
  if (runNode.children.length === 0) return 1;
  return runNode.children.reduce((sum, child) => sum + subtreeLeafCount(child), 0);
};

const calculateNodePositions = (tracks: readonly RunTree[]): VueFlowNode[] => {
  const nodes: VueFlowNode[] = [];
  let trackY = 0;

  const traverseTrack = (runNode: RunTree, x: number, y: number) => {
    nodes.push(createVueFlowNode(runNode, { x, y }));
    const childX = x + LAYOUT.NODE_WIDTH + LAYOUT.HORIZONTAL_GAP;

    if (runNode.children.length === 1) {
      // Sequential: continue same row
      traverseTrack(runNode.children[0], childX, y);
    } else if (runNode.children.length > 1) {
      // Parallel: fan out vertically
      const totalLeaves = runNode.children.reduce((s, c) => s + subtreeLeafCount(c), 0);
      const totalPixelHeight = (totalLeaves - 1) * ROW_HEIGHT;
      let currentY = y - totalPixelHeight / 2;

      runNode.children.forEach(child => {
        const childLeaves = subtreeLeafCount(child);
        const childCenterY = currentY + ((childLeaves - 1) * ROW_HEIGHT) / 2;
        traverseTrack(child, childX, childCenterY);
        currentY += childLeaves * ROW_HEIGHT;
      });
    }
  };

  // Iterate in reverse so the newest track (last in array) is placed at the top
  // (y = 0) and older tracks slide downward as history grows.
  for (let i = tracks.length - 1; i >= 0; i--) {
    const track = tracks[i];
    const trackLeaves = subtreeLeafCount(track);
    const trackContentHeight = (trackLeaves - 1) * ROW_HEIGHT + LAYOUT.NODE_HEIGHT;
    traverseTrack(track, 0, trackY + trackContentHeight / 2);
    trackY += trackContentHeight + LAYOUT.TRACK_GAP;
  }

  return nodes;
};

// Limit canvas to the 150 most recent event tracks
const MAX_CANVAS_TRACKS = 150;
const recentTracks = computed(() => {
  if (!props.runNodeTree?.length) return [];
  return props.runNodeTree.length > MAX_CANVAS_TRACKS
    ? props.runNodeTree.slice(-MAX_CANVAS_TRACKS)
    : props.runNodeTree;
});

// Convert RunNode tree to VueFlow nodes
const nodes = computed<VueFlowNode[]>(() => {
  if (!recentTracks.value.length) return [];
  return calculateNodePositions(recentTracks.value);
});

const edges = computed<Edge[]>(() => {
  if (!recentTracks.value.length) return [];

  const result: Edge[] = [];

  // Helper to recursively build edges — every child connects to its parent
  const buildEdges = (runNode: RunTree) => {
    runNode.children.forEach((child) => {
      result.push({
        id: `${runNode.id}-to-${child.id}`,
        source: runNode.id,
        target: child.id,
        type: 'smoothstep',
        animated: runNode.status === 'active',
      });
      buildEdges(child);
    });
  };

  recentTracks.value.forEach(track => buildEdges(track));

  return result;
});

// Register node event handlers using Vue Flow composables
onNodeClick((event: NodeMouseEvent) => {
  const nodeData = event.node.data as { kind?: string };
  
  if (nodeData.kind === 'flow') {
    // For flow nodes, delay single click to allow for double-click detection
    if (clickTimeout) {
      clearTimeout(clickTimeout);
    }
    clickTimeout = setTimeout(() => {
      emit('node-click', event.node.id);
      clickTimeout = null;
    }, DOUBLE_CLICK_DELAY);
  } else if (nodeData.kind === 'step' || nodeData.kind === 'event') {
    // Step and event nodes always open details immediately
    emit('node-click', event.node.id);
  }
});

onNodeDoubleClick((event: NodeMouseEvent) => {
  const nodeData = event.node.data as { kind?: string };
  
  // Only flow nodes can be navigated into on double click
  if (nodeData.kind === 'flow') {
    // Cancel the pending single-click action
    if (clickTimeout) {
      clearTimeout(clickTimeout);
      clickTimeout = null;
    }
    emit('flow-navigate', event.node.id);
  }
  // Step nodes and event nodes don't have double click behavior
});

// Pan to the latest track (now at the top after the bottom-up flip),
// preserving the current zoom level.
const panToLatestTrack = () => {
  const tracks = recentTracks.value;
  if (!tracks?.length) return;

  const positions = new Map(nodes.value.map(n => [n.id, n.position]));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  const visit = (n: RunTree) => {
    const p = positions.get(n.id);
    if (p) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + LAYOUT.NODE_WIDTH);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y + LAYOUT.NODE_HEIGHT);
    }
    n.children.forEach(visit);
  };
  visit(tracks[tracks.length - 1]);

  if (minX === Infinity) return;

  setCenter((minX + maxX) / 2, (minY + maxY) / 2, {
    duration: 400,
    zoom: getViewport().zoom,
  });
};

// Animation helpers
const cancelCurrentAnimation = () => {
  if (animationController) {
    animationController.abort();
    animationController = null;
  }
};

const animateToNode = async (nodeId: string, position: { x: number; y: number }, signal: AbortSignal) => {
  const attemptCenter = async (attempt: number = 0): Promise<void> => {
    if (signal.aborted) return;
    
    const flowNode = getNode.value(nodeId);
    if (flowNode?.dimensions) {
      const centerX = position.x + (flowNode.dimensions.width || LAYOUT.NODE_WIDTH) / 2;
      const centerY = position.y + (flowNode.dimensions.height || LAYOUT.NODE_HEIGHT) / 2;
      
      await setCenter(centerX, centerY, { 
        duration: ANIMATION.DURATION, 
        zoom: 1 
      });
    } else if (attempt < ANIMATION.MAX_RETRY_ATTEMPTS) {
      // Retry after a frame
      await new Promise(resolve => setTimeout(resolve, ANIMATION.RETRY_DELAY));
      return attemptCenter(attempt + 1);
    }
  };
  
  // Wait for next frame to ensure DOM is updated
  await new Promise(resolve => requestAnimationFrame(resolve));
  return attemptCenter();
};

// Watch for node changes — handles both incremental additions and structural changes (sub-flow navigation)
watch(() => nodes.value, (newNodes) => {
  const currentIds = new Set(newNodes.map(n => n.id));
  const newNodeIds = newNodes.map(n => n.id).filter(id => !previousNodeIds.has(id));
  const removedCount = [...previousNodeIds].filter(id => !currentIds.has(id)).length;

  const isStructuralChange = previousNodeIds.size > 0 && removedCount > previousNodeIds.size / 2;

  if (isStructuralChange) {
    cancelCurrentAnimation();
    nextTick(() => {
      setTimeout(panToLatestTrack, 150);
    });
  } else if (newNodeIds.length > 0 && props.animationsEnabled) {
    cancelCurrentAnimation();
    const targetNodeId = newNodeIds[newNodeIds.length - 1];
    const targetNode = newNodes.find(n => n.id === targetNodeId);
    if (targetNode) {
      animationController = new AbortController();
      animateToNode(targetNodeId, targetNode.position, animationController.signal);
    }
  }

  previousNodeIds = currentIds;
}, { immediate: true });

// Watch for selected node changes and center the node in view
watch(() => props.selectedNodeId, (newSelectedId, oldSelectedId) => {
  if (newSelectedId && newSelectedId !== oldSelectedId) {
    setTimeout(() => centerNodeInView(newSelectedId), 100);
  }
});

onMounted(() => {
  canvasRoot.value?.addEventListener('mouseenter', clearStalePan);
});

// Cleanup on unmount
onUnmounted(() => {
  canvasRoot.value?.removeEventListener('mouseenter', clearStalePan);
  cancelCurrentAnimation();
  previousNodeIds.clear();
  if (clickTimeout) {
    clearTimeout(clickTimeout);
  }
});
</script> 
