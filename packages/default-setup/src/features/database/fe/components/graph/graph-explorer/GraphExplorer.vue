<!--
  [GRAPH_EXPLORER_FF] PARKED — reached only from ../canvas-graph.vue, which
  nothing imports. See that file's header before changing anything here.
-->
<template>
  <div class="flex flex-col h-full graph-explorer">
    <!-- Header with Controls -->
    <GraphToolbar
      v-model:current-layout="currentLayout"
      :layouts="[...AVAILABLE_LAYOUTS]"
      :has-data="hasData"
      :has-graph-instance="!!graphInstance"
      :node-count="nodeCount"
      :edge-count="edgeCount"
      :zoom-level="zoomLevel"
      :is-fullscreen="isFullscreen"
      @layout-change="handleLayoutChange"
      @zoom-in="handleZoomIn"
      @zoom-out="handleZoomOut"
      @fit-view="handleFitView"
      @toggle-fullscreen="toggleFullscreen"
    />
    
    <!-- Graph Container -->
    <div class="relative flex-1 overflow-hidden">
      <div 
        ref="graphContainer" 
        class="absolute inset-0 bg-neutral-800 dark:bg-gray-800"
        :class="{ 'cursor-grabbing': isDragging }"
      />
      
      <!-- Empty State -->
      <EmptyState v-if="!hasData && !isLoading" />
      
      <!-- Loading State -->
      <LoadingState v-if="isLoading" />
      
      <!-- Selected Node Info Panel -->
      <NodeInfoPanel 
        v-if="selectedNode"
        :node="selectedNode"
        @close="selectedNode = null"
      />
    </div>
    
    <!-- Legend -->
    <GraphLegend :colors="ENTITY_COLORS" />
  </div>
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { ref, computed, watch, onMounted, onUnmounted, shallowRef } from 'vue';
import { Graph } from '@antv/g6';
import type { GraphData, NodeData, EdgeData } from '@antv/g6';
import { useGraphInstance } from './composables/useGraphInstance.ts';
import { useGraphInteractions } from './composables/useGraphInteractions.ts';
import { ENTITY_COLORS, AVAILABLE_LAYOUTS } from '../constants.ts';
import EmptyState from './components/EmptyState.vue';
import LoadingState from './components/LoadingState.vue';
import NodeInfoPanel from './components/NodeInfoPanel.vue';
import GraphLegend from './components/GraphLegend.vue';
import GraphToolbar from './components/GraphToolbar.vue';
import type { DatabaseState } from '../../../state.ts'

// Props & Emits
interface Props {
  readonly?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  readonly: false
});

// State Management
const actor: DatabaseState = useSurface();
const { state: database } = useState(actor);

// Component State
const graphContainer = ref<HTMLElement>();
const graphInstance = shallowRef<Graph | null>(null);
const selectedNode = ref<NodeData | null>(null);
const isFullscreen = ref(false);
const currentLayout = ref('d3-force');
const zoomLevel = ref(1);
const isLoading = ref(false);
const isDragging = ref(false);

// Computed Properties
const hasData = computed(() => database.value.data.queryResult.nodes.length > 0);
const nodeCount = computed(() => database.value.data.queryResult.nodes.length);
const edgeCount = computed(() => database.value.data.queryResult.edges.length);

// Composables
const { 
  initializeGraph, 
  updateGraphData, 
  destroyGraph 
} = useGraphInstance(graphContainer, graphInstance);

const {
  handleNodeClick,
  handleCanvasClick,
  handleZoomChange,
  handleDragStart,
  handleDragEnd
} = useGraphInteractions(graphInstance, selectedNode, zoomLevel, isDragging);

// Graph Operations
async function setupGraph() {
  if (!hasData.value || !graphContainer.value) return;
  
  isLoading.value = true;
  
  try {
    const data = transformQueryData();
    
    const graph = await initializeGraph({
      data,
      layout: { type: currentLayout.value },
      behaviors: props.readonly ? ['zoom-canvas', 'drag-canvas'] : undefined,
      onNodeClick: handleNodeClick,
      onCanvasClick: handleCanvasClick,
      onZoomChange: handleZoomChange,
      onDragStart: handleDragStart,
      onDragEnd: handleDragEnd
    });
    
    if (graph) {
      graphInstance.value = graph;
      await graph.fitView();
    }
  } catch (error) {
    console.error('Failed to setup graph:', error);
  } finally {
    isLoading.value = false;
  }
}

function transformQueryData(): GraphData {
  const nodes: NodeData[] = database.value.data.queryResult.nodes.map((node: any) => ({
    id: node.id,
    data: {
      type: node.type,
      label: extractLabel(node.id),
      ...node
    }
  }));
  
  const nodeIdSet = new Set(nodes.map(n => n.id));
  const edges: EdgeData[] = database.value.data.queryResult.edges
    .filter((edge: any) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target))
    .map((edge: any, index: number) => ({
      id: `edge-${index}`,
      source: edge.source,
      target: edge.target,
      data: {
        type: edge.type,
        ...edge
      }
    }));
  
  return { nodes, edges };
}

function extractLabel(id: string): string {
  const parts = id.split('-');
  return parts[parts.length - 1] || id;
}

// Event Handlers
async function handleLayoutChange(newLayout: string) {
  if (!graphInstance.value) return;
  
  currentLayout.value = newLayout;
  
  try {
    await graphInstance.value.layout({ type: newLayout });
    await graphInstance.value.fitView();
  } catch (error) {
    console.error('Failed to change layout:', error);
  }
}

function handleZoomIn() {
  if (!graphInstance.value) return;
  const currentZoom = graphInstance.value.getZoom();
  graphInstance.value.zoomTo(Math.min(currentZoom * 1.2, 3), { duration: 200 });
}

function handleZoomOut() {
  if (!graphInstance.value) return;
  const currentZoom = graphInstance.value.getZoom();
  graphInstance.value.zoomTo(Math.max(currentZoom * 0.8, 0.3), { duration: 200 });
}

async function handleFitView() {
  if (!graphInstance.value) return;
  await graphInstance.value.fitView();
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    const elem = graphContainer.value?.closest('.graph-explorer') || document.documentElement;
    elem.requestFullscreen();
    isFullscreen.value = true;
  } else {
    document.exitFullscreen();
    isFullscreen.value = false;
  }
}

// Keyboard shortcuts
function handleFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
}

function handleKeyboard(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey) {
    switch (e.key) {
      case '=':
      case '+':
        e.preventDefault();
        handleZoomIn();
        break;
      case '-':
        e.preventDefault();
        handleZoomOut();
        break;
      case '0':
        e.preventDefault();
        handleFitView();
        break;
    }
  } else if (e.key === 'F11') {
    e.preventDefault();
    toggleFullscreen();
  }
}

// Watchers
watch(() => database.value.data.queryResult, async () => {
  if (!hasData.value) {
    await destroyGraph();
    return;
  }
  
  if (!graphInstance.value) {
    await setupGraph();
  } else {
    const data = transformQueryData();
    await updateGraphData(data);
  }
}, { deep: true, immediate: true });

// Lifecycle
onMounted(() => {
  document.addEventListener('keydown', handleKeyboard);
  
  // Listen for fullscreen changes
  document.addEventListener('fullscreenchange', handleFullscreenChange);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyboard);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  destroyGraph();
});
</script>

<style scoped>
/* Fullscreen mode adjustments */
:global(:fullscreen) .graph-explorer {
  background: theme('colors.gray.900');
}

:global(:fullscreen) .graph-explorer .legend-container {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
}


</style> 