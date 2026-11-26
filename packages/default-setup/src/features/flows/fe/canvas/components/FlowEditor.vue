<template>
  <div class="relative flex-1">
    <VueFlow
      :nodes="nodes"
      :edges="edges"
      class="w-full h-full bg-neutral-900"
      data-onboarding-id="flow-editor-canvas"
      :fit-view-on-init="false"
      :connection-line-type="ConnectionLineType.SmoothStep"
      :default-edge-options="{
        type: 'generic',
        style: { strokeWidth: 2 },
        markerEnd: MarkerType.Arrow
      }"
      :default-viewport="{ x: 0, y: 0, zoom: 1 }"
      :connect-on-click="false"
      :edges-selectable="true"
      :edges-updatable="true"
      :delete-key-code="['Backspace', 'Delete']"
      :pan-activation-key-code="null"
      :edge-updater-radius="10"
      :is-valid-connection="isValidConnection"
      @node-click="handleNodeClick"
      @node-double-click="handleNodeDoubleClick"
      @pane-click="handlePaneClick"
      @connect="$emit('connect', $event)"
      @drop="$emit('drop', $event)"
      @dragover.prevent
      @nodes-initialized="$emit('nodes-initialized')"
      @node-drag-stop="$emit('node-drag-stop', $event)"
      @nodes-change="handleNodesChange"
      @edges-change="handleEdgesChange"
      @edge-update-start="handleEdgeUpdateStart"
      @edge-update="handleEdgeUpdate"
      @edge-update-end="handleEdgeUpdateEnd"
      :min-zoom="0.2"
      :max-zoom="2"
    >
      <template v-for="(_, type) in nodeTypes" #[`node-${type}`]="nodeProps">
        <component
          :is="nodeTypes[type]"
          v-bind="nodeProps"
          :is-editing="nodeProps.id === editingNodeId"
          :selected-handle="props.selectedHandle"
          :connected-handles="connectedHandles"
          :key="type"
          @create-connected="(nodeType: string, sourceHandle?: string) => $emit('create-connected', nodeType, nodeProps.id, sourceHandle)"
          @handle-select="(nodeId: string, handleId?: string) => $emit('handle-select', nodeId, handleId)"
          @edge-select="(nodeId: string, handleId?: string) => $emit('edge-select', nodeId, handleId)"
          @remove-handle="(nodeId: string, handleId?: string) => $emit('remove-handle', nodeId, handleId)"
        />
      </template>
      <template #edge-generic="edgeProps">
        <GenericEdge v-bind="edgeProps" />
      </template>
      <Background variant="dots" />
      <Controls />
      <!-- <MiniMap
        :maskColor="'#26262650'"
        :maskStrokeColor="'transparent'"
        class="opacity-[0.15] hover:opacity-100 transition-opacity duration-200 bg-neutral-900 border border-neutral-700 rounded-lg"
      /> -->

      <!-- Back button (top left) -->
      <div class="absolute z-10 top-4 left-4">
        <button
          class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-all duration-200 rounded-md bg-neutral-900/90 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 hover:text-neutral-100 backdrop-blur-sm"
          @click="$emit('go-back')"
          title="Back to flows list"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      </div>

      <!-- Auto Layout button (bottom left) -->
      <div class="absolute z-10 bottom-4 left-4">
        <button
          class="flex items-center justify-center p-1.5 text-sm rounded-md bg-neutral-900/90 border border-neutral-800 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition-all backdrop-blur-sm"
          title="Auto layout"
          @click="$emit('action-layout', 'LR')"
        >
          <Maximize :size="16" />
        </button>
      </div>
    </VueFlow>

    <!-- Backdrop overlay when in list state -->
    <div
      v-if="showOverlay"
      class="absolute inset-0 z-10 cursor-pointer bg-black/30 hover:bg-black/20 transition-all duration-200 flex items-center justify-center group"
      @click="$emit('overlay-click')"
    >
      <div class="pointer-events-none flex items-center gap-2.5 px-5 py-2.5 rounded-lg bg-neutral-800/80 border border-neutral-600/40 shadow-xl shadow-black/30 group-hover:bg-neutral-700/80 group-hover:border-neutral-500/50 group-hover:scale-105 transition-all duration-200">
        <Pencil :size="15" class="text-neutral-400 group-hover:text-neutral-200 transition-colors" />
        <span class="text-sm font-medium text-neutral-200 group-hover:text-white transition-colors">
          {{ props.selectedFlowLabel || 'Edit Flow' }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch, computed, provide } from 'vue'
import {
  VueFlow,
  ConnectionLineType,
  MarkerType,
} from '@vue-flow/core'
import type { Connection, NodeMouseEvent, Node as VueFlowNode, Edge, EdgeMouseEvent, EdgeUpdateEvent, GraphEdge, GraphNode } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
// import { MiniMap } from '@vue-flow/minimap'
import { Maximize, Pencil } from 'lucide-vue-next'

import GenericEdge from '../edges/GenericEdge.vue'
import AddHandle from '../nodes/AddHandle.vue'
import { useNodeTypes } from '../nodes/index.ts'
import { useNodeViewport } from '../useNodeViewport.ts'

import type { LayoutDirection } from '#features/flows/fe/canvas/layout-utils.ts'
import { useNodeStyles } from '@apackdev/ui/components/node-styles'

const { isTriggerNode } = useNodeStyles()

provide('BaseNodeAddHandle', AddHandle)

interface Props {
  nodes: VueFlowNode[]
  edges: Edge[]
  selectedFlowId?: string | null
  selectedFlowLabel?: string
  selectedNodeId?: string
  editingNodeId?: string
  showOverlay?: boolean
  // Handle selection for click-to-connect
  selectedHandle?: { nodeId: string; handleId?: string }
}

const props = defineProps<Props>()
const nodeTypes = useNodeTypes()
const { centerNodeInView } = useNodeViewport()

// Build a set of connected source handles: "nodeId" or "nodeId:handleId"
const connectedHandles = computed(() => {
  const connected = new Set<string>()
  for (const edge of props.edges) {
    if (edge.sourceHandle) {
      connected.add(`${edge.source}:${edge.sourceHandle}`)
    } else {
      connected.add(edge.source)
    }
  }
  return connected
})

const emit = defineEmits<{
  'node-click': [event: NodeMouseEvent]
  'node-double-click': [event: NodeMouseEvent]
  'connect': [params: Connection]
  'drop': [event: DragEvent]
  'go-back': []
  'action-layout': [direction?: LayoutDirection]
  'overlay-click': []
  'nodes-initialized': []
  'node-drag-stop': [event: NodeMouseEvent]
  'nodes-remove': [nodes: { id: string }[]]
  'selection-change': [changes: { id: string; selected: boolean }[]]
  'edges-remove': [edges: { id: string }[]]
  'edge-update': [event: EdgeUpdateEvent]
  'edge-update-end': [event: EdgeMouseEvent]
  'create-connected': [nodeType: string, sourceNodeId: string, sourceHandle?: string]
  'handle-select': [nodeId: string, handleId?: string]
  'handle-deselect': []
  'edge-select': [nodeId: string, handleId?: string]
  'remove-handle': [nodeId: string, handleId?: string]
}>()

// Watch for editing node changes and center the node
let previousEditingId: string | undefined = undefined
watch(() => props.editingNodeId, async (newEditingId) => {
  if (newEditingId && newEditingId !== previousEditingId) {
    // Small delay to ensure node is rendered and dimensions are available
    setTimeout(async () => {
      await centerNodeInView(newEditingId)
    }, 100)
  }
  previousEditingId = newEditingId
})

function handleNodesChange(changes: any[]) {
  // Filter for remove changes
  const removedNodes = changes
    .filter(change => change.type === 'remove')
    .map(change => ({ id: change.id }));

  if (removedNodes.length > 0) {
    emit('nodes-remove', removedNodes);
  }

  // Handle selection changes
  const selectionChanges = changes
    .filter(change => change.type === 'select')
    .map(change => ({ id: change.id, selected: change.selected }));

  if (selectionChanges.length > 0) {
    emit('selection-change', selectionChanges);
  }
}

function handleEdgesChange(changes: any[]) {
  // Filter for remove changes
  const removedEdges = changes
    .filter(change => change.type === 'remove')
    .map(change => ({ id: change.id }));

  if (removedEdges.length > 0) {
    emit('edges-remove', removedEdges);
  }
}

async function handleNodeClick(event: NodeMouseEvent) {
  const target = event.event.target as HTMLElement
  if (target.closest('[data-action="open-form"]')) {
    emit('node-double-click', event) // Icon click opens form like double-click
  } else {
    emit('node-click', event)
  }
}

async function handleNodeDoubleClick(event: NodeMouseEvent) {
  emit('node-double-click', event)
}

function handlePaneClick() {
  // Deselect handle when clicking on canvas background
  if (props.selectedHandle) {
    emit('handle-deselect')
  }
}

// Edge reconnection handlers
function handleEdgeUpdateStart(event: EdgeMouseEvent) {
  // Edge update start - Vue Flow handles the drag state internally
}

function handleEdgeUpdate(event: EdgeUpdateEvent) {
  // Edge update event is fired when edge is successfully reconnected
  emit('edge-update', event)
}

function handleEdgeUpdateEnd(event: EdgeMouseEvent) {
  // Edge update end - Vue Flow handles cleanup
  emit('edge-update-end', event)
}

// Validates drag-to-connect only (connect-on-click is disabled; click-to-connect uses the surface state).
// NOTE: Do NOT add a duplicate-edge check here. VueFlow calls isValidConnection for ALL edges
// when the :edges prop changes (not just drag operations), causing edges to reject themselves
// as duplicates. Duplicate prevention is handled in surface state handlers instead.
function isValidConnection(
  connection: Connection,
  elements: { edges: GraphEdge[]; nodes: GraphNode[]; sourceNode: GraphNode; targetNode: GraphNode }
): boolean {
  if (connection.source === connection.target) return false
  if (isTriggerNode(elements.targetNode?.data?.nodeType)) return false
  return true
}
</script>
