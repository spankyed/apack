<template>
  <div class="relative flex w-full h-full overflow-hidden">
    <!-- ▸ Node palette (left) -->
    <aside class="overflow-y-auto text-white border-r w-60 bg-neutral-900 border-neutral-800">
      <!-- Flows list view -->
      <FlowsList
        v-if="inListState"
        :flows="flows"
        :root-flow-id="rootFlowId"
        :selected-flow-id="selectedFlowId"
        :multi-selected-flow-ids="multiSelectedFlowIds"
        @flow-click="handleFlowClick"
        @flow-dblclick="handleFlowDblClick"
        @create-flow="handleCreateFlow"
        @request-delete="openDeleteDialog"
        @request-edit-label="openEditDialog"
        @export-dsl="handleExportFlowDSL"
      />

      <!-- Steps palette view -->
      <NodePalette
        v-if="inViewState"
        @palette-click="handlePaletteClick"
      />
    </aside>

    <!-- ▸ VueFlow canvas (center) -->
    <FlowEditor
      :nodes="plainNodes"
      :edges="plainEdges"
      :selected-flow-id="selectedFlowId"
      :selected-flow-label="currentFlowLabel"
      :selected-node-id="selected?.id"
      :editing-node-id="editingNode?.id"
      :show-overlay="inListState"
      :selected-handle="selectedHandle"
      @node-click="handleNodeClick"
      @node-double-click="handleNodeDoubleClick"
      @connect="handleConnect"
      @drop="handleDrop"
      @go-back="handleGoBack"
      @action-layout="handleLayout"
      @overlay-click="handleOverlayClick"
      @nodes-initialized="handleNodesInitialized"
      @node-drag-stop="handleNodeDragStop"
      @nodes-remove="handleNodesRemove"
      @selection-change="handleSelectionChange"
      @edges-remove="handleEdgesRemove"
      @edge-update="handleEdgeUpdate"
      @edge-update-end="handleEdgeUpdateEnd"
      @create-connected="handleCreateConnectedNode"
      @handle-select="handleHandleSelect"
      @handle-deselect="handleHandleDeselect"
      @edge-select="handleEdgeSelect"
      @remove-handle="handleRemoveHandle"
    />

    <!-- ▸ Node form overlay -->
    <NodeForm
      :selected-node="editingNode"
      :actions="actions"
      :flows="flows"
      :models="models"
      :prompts="prompts"
      :edges="plainEdges"
      @close="handleCloseNodeEditor"
      @update-node="handleNodeUpdate"
      @reindex-branches="handleReindexBranches"
      @create-connected="handleCreateConnectedNode"
    />

    <!-- Label Edit Dialog -->
    <FlowLabelDialog
      v-model="labelDialogOpen"
      :flow-label="currentFlowLabel"
      @cancel="() => { labelDialogOpen = false; targetFlow = null }"
      @save="handleUpdateLabel"
    />

    <!-- Centralized Delete Confirmation Dialog -->
    <ConfirmationDialog
      v-model="deleteDialogOpen"
      :title="deleteDialogTitle"
      :description="deleteDialogDescription"
      :confirm-text="deleteDialogConfirmText"
      cancel-text="Cancel"
      variant="danger"
      @confirm="handleConfirmDelete"
      @cancel="handleCancelDelete"
    />

    <ToastNotification ref="canvasToast" />
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { computed, type Ref, ref, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import type { Connection, NodeMouseEvent, Node as VueFlowNode, EdgeUpdateEvent, EdgeMouseEvent } from '@vue-flow/core'
import { calculateLayoutAsync, type LayoutDirection } from '#features/flows/fe/canvas/layout-utils.ts'
import type { NodeEntity } from '#generated/types.ts'
import { useNodeStyles } from '@apackdev/ui/components/node-styles'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

import { type FlowsState } from '#features/flows/fe/state.ts'
import { useView } from '#generated/fe.ts'
import { useSelector } from '@xstate/vue'

// Import sub-components
import FlowsList from './components/FlowsList.vue'
import NodePalette from './components/NodePalette.vue'
import FlowEditor from './components/FlowEditor.vue'
import NodeForm from './components/NodeForm.vue'
import FlowLabelDialog from './components/FlowLabelDialog.vue'
import ConfirmationDialog from '@apackdev/ui/design/ConfirmationDialog'
import ToastNotification from '@apackdev/ui/design/ToastNotification'
import type { FlowEntity, EARS } from '@apackdev/sdk'

const { isTriggerNode } = useNodeStyles()

const { project, fitView, addSelectedEdges, getEdges } = useVueFlow()

// Dialog state
const labelDialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const targetFlow = ref<Partial<FlowEntity> | null>(null)

/* ------------------------------------------------------------ */
/*  reactive state from the actor                               */
/* ------------------------------------------------------------ */
const actor: FlowsState = useSurface()

const inListState = useSelector(actor, (s) => s.hasTag('list-flows'))
const inViewState = useSelector(actor, (s) => s.hasTag('view-flow'))
const nodes   = useSelector(actor, (s) => s.context.graph.nodes)
const edges   = useSelector(actor, (s) => s.context.graph.edges)
const settings = useSelector(actor, (s) => s.context.settings)
const allFlows = useSelector(actor, (s) => s.context.flows)
const flows   = useSelector(actor, (s) => {
  const rootId = s.context.rootFlowId
  const all = s.context.flows
  if (!rootId) return all
  const root = all.find(f => f.id === rootId)
  const rest = all.filter(f => f.id !== rootId)
  return root ? [root, ...rest] : rest
})
const rootFlowId = useSelector(actor, (s) => s.context.rootFlowId)
const positions = useSelector(actor, (s) => s.context.graph.positions)
const selectedFlowId = useSelector(actor, (s) => s.context.selectedFlowId)
const selectedNodeId = useSelector(actor, (s) => s.context.selectedNodeId)
const selected = useSelector(actor, (s) =>
  s.context.graph.nodes.find(node => node.id === s.context.selectedNodeId)
) as Ref<NodeEntity | undefined>
const editingNode = useSelector(actor, (s) =>
  s.context.graph.nodes.find(node => node.id === s.context.editingNodeId)
) as Ref<NodeEntity | undefined>
// Every action, for the node palette: the actions feature's list, kept current by the backend
const actionList = useView('actions', 'list', { limit: null, categories: [] })
const actions = computed(() => actionList.data?.actions ?? [])
const models = useSelector(actor, (s) => s.context.models)
const prompts = useSelector(actor, (s) => s.context.prompts)
const selectedHandle = useSelector(actor, (s) => s.context.selectedHandle)
const canvasError = useSelector(actor, (s) => s.context.canvasError)

const canvasToast = ref<InstanceType<typeof ToastNotification>>()

watch(canvasError, (error) => {
  if (error) {
    canvasToast.value?.error(error)
    actor.send({ type: 'CANVAS.CLEAR_ERROR' })
  }
})

// Context-menu dialog bridge flags
const showEditLabelDialog = useSelector(actor, (s) => s.context.showEditLabelDialog)
const showDeleteFlowDialog = useSelector(actor, (s) => s.context.showDeleteFlowDialog)

watch(showEditLabelDialog, (show) => {
  if (show) {
    openEditDialog()
    actor.send({ type: 'FLOW.DIALOG_CLOSED' })
  }
})
watch(showDeleteFlowDialog, (show) => {
  if (show) {
    if (currentFlow.value) openDeleteDialog(currentFlow.value)
    actor.send({ type: 'FLOW.DIALOG_CLOSED' })
  }
})

// Multi-select state (local only, separate from XState selectedFlowId)
const multiSelectedFlowIds = ref<Set<string>>(new Set())
const shiftAnchorFlowId = ref<string | null>(null)

// Prevent accidental palette clicks when transitioning from list → view state
const paletteClickDisabled = ref(false)

watch(inViewState, (isView) => {
  if (isView) {
    paletteClickDisabled.value = true
    clearMultiSelect()
    setTimeout(() => {
      paletteClickDisabled.value = false
    }, 500)
  }
})

// Delete selected flow on Backspace/Delete while in list state
function handleKeydown(e: KeyboardEvent) {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return
  if (!inListState.value) return
  // Don't intercept when user is typing in an input
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return

  if (multiSelectedFlowIds.value.size > 0) {
    openDeleteDialog()
  } else if (selectedFlowId.value) {
    const flow = flows.value.find(f => f.id === selectedFlowId.value)
    if (flow) openDeleteDialog(flow)
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

// Watch for flow changes and re-center view after layout is computed
watch(selectedFlowId, () => {
  // When flow changes, watch for next position update then fitView
  const unwatch = watch(positions, (newPositions) => {
    if (Object.keys(newPositions).length > 0) {
      nextTick(() => fitView())
      unwatch()
    }
  })
}, { immediate: true })

const plainNodes = computed(() => {
  const selId = selectedNodeId.value
  const mappedNodes = nodes.value
    .map((n) => ({
      id       : n.id!,
      type     : n.nodeType,
      position : {
        x: positions.value[n.id]?.x ?? 0,
        y: positions.value[n.id]?.y ?? 0
      },
      selected : n.id === selId,
      data     : n,
    })) as VueFlowNode[]

  return mappedNodes
})

const plainEdges = computed(() =>
  Object.values(edges.value).map((e) => {
    const sourceNode = nodes.value.find(n => n.id === e.source)
    const isFromEventNode = isTriggerNode(sourceNode?.nodeType)
    const isAnimated = e.kind === 'transitions_to' && isFromEventNode

    return {
      id     : e.id,
      source : e.source,
      target : e.target,
      sourceHandle: e.sourceHandle,
      data: { kind: e.kind, animated: isAnimated },
    }
  })
)

const currentFlow = computed(() =>
  allFlows.value.find(f => f.id === selectedFlowId.value)
)

const currentFlowLabel = computed(() =>
  currentFlow.value?.label || (currentFlow.value?.id === rootFlowId.value ? 'Main Flow' : '')
)

/* ------------------------------------------------------------ */
/*  Event handlers                                              */
/* ------------------------------------------------------------ */

function handleDrop(e: DragEvent) {
  const nodeType = e.dataTransfer?.getData('application/vueflow')
  if (!nodeType) return

  // Get the bounding rect of the target element
  const target = e.target as HTMLElement
  const rect = target.getBoundingClientRect()

  // Calculate position relative to the flow container
  const position = project({
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  })

  actor.send({
    type: 'NODE.CREATE',
    nodeType,
    position,
  })
}

function handlePaletteClick(nodeType: string) {
  if (paletteClickDisabled.value) return
  actor.send({
    type: 'NODE.CREATE',
    nodeType,
  })
}

function handleCreateConnectedNode(nodeType: string, sourceNodeId: string, sourceHandle?: string) {
  actor.send({
    type: 'NODE.CREATE_CONNECTED',
    nodeType,
    sourceNodeId,
    sourceHandle,
  })
}

function handleHandleSelect(nodeId: string, handleId?: string) {
  actor.send({ type: 'HANDLE.SELECT', nodeId, handleId })
}

function handleHandleDeselect() {
  actor.send({ type: 'HANDLE.DESELECT' })
}

function handleEdgeSelect(nodeId: string, handleId?: string) {
  // Find the edge from VueFlow's internal state (has full GraphEdge type)
  const edge = getEdges.value.find(e =>
    e.source === nodeId &&
    (handleId ? e.sourceHandle === handleId : !e.sourceHandle)
  )
  if (edge) {
    addSelectedEdges([edge])
  }
}

function handleRemoveHandle(nodeId: string, handleId?: string) {
  const parsed = handleId?.match(/(exit|branch)-(\d+)/)
  if (parsed) {
    actor.send({
      type: 'HANDLE.REINDEX',
      nodeId,
      prefix: parsed[1],
      index: parseInt(parsed[2], 10),
      direction: -1,
    })
  }
}

function handleNodeClick(e: NodeMouseEvent) {
  actor.send({ type: 'NODE.CLICK', nodeId: e.node.id })
}

function handleNodeDoubleClick(e: NodeMouseEvent) {
  actor.send({ type: 'NODE.DOUBLE_CLICK', nodeId: e.node.id })
}

function handleCloseNodeEditor() {
  actor.send({ type: 'NODE.EDITOR.CLOSE' })
}

function handleConnect(params: Connection) {
  actor.send({
    type: 'EDGE.CONNECT',
    src: params.source,
    tgt: params.target,
    sourceHandle: params.sourceHandle || undefined,
    targetHandle: params.targetHandle || undefined,
  })
}

function handleFlowClick(flow: Partial<FlowEntity>, event: MouseEvent) {
  if (!flow.id) return

  if (event.shiftKey) {
    handleShiftClick(flow)
    return
  }

  // Normal click: clear multi-select, set anchor, run preview logic
  clearMultiSelect()
  shiftAnchorFlowId.value = flow.id

  const enablePreview = settings.value?.enableFlowPreview ?? true
  const isAlreadySelected = selectedFlowId.value === flow.id
  const shouldOpenEditor = !enablePreview || isAlreadySelected

  actor.send({
    type: shouldOpenEditor ? 'FLOW.SELECT' : 'FLOW.PREVIEW',
    flowId: flow.id
  })
}

function handleShiftClick(flow: Partial<FlowEntity>) {
  if (!flow.id) return
  const anchorId = shiftAnchorFlowId.value || selectedFlowId.value
  if (!anchorId) return

  const flowList = flows.value
  const anchorIdx = flowList.findIndex(f => f.id === anchorId)
  const clickedIdx = flowList.findIndex(f => f.id === flow.id)
  if (anchorIdx === -1 || clickedIdx === -1) return

  const start = Math.min(anchorIdx, clickedIdx)
  const end = Math.max(anchorIdx, clickedIdx)

  const newSelection = new Set<string>()
  for (let i = start; i <= end; i++) {
    const f = flowList[i]
    // Exclude root flow from multi-select
    if (f.id && f.id !== rootFlowId.value) {
      newSelection.add(f.id)
    }
  }
  multiSelectedFlowIds.value = newSelection
}

function clearMultiSelect() {
  multiSelectedFlowIds.value = new Set()
}

function handleFlowDblClick(flow: Partial<FlowEntity>) {
  clearMultiSelect()
  if (flow.id) actor.send({ type: 'FLOW.SELECT', flowId: flow.id })
}

function handleCreateFlow() {
  actor.send({ type: 'FLOW.CREATE' })
}

// Unified dialog handlers
function openEditDialog(flow?: Partial<FlowEntity>) {
  targetFlow.value = flow || currentFlow.value || null
  if (targetFlow.value) labelDialogOpen.value = true
}

// Bulk delete computeds
const isBulkDelete = computed(() => multiSelectedFlowIds.value.size > 1)
const deleteDialogTitle = computed(() =>
  isBulkDelete.value ? `Delete ${multiSelectedFlowIds.value.size} Flows` : 'Delete Flow'
)
const deleteDialogDescription = computed(() => {
  if (isBulkDelete.value) {
    return `Are you sure you want to delete ${multiSelectedFlowIds.value.size} flows? This action cannot be undone. All nodes and connections in these flows will be permanently deleted.`
  }
  return `Are you sure you want to delete '${targetFlow.value?.label || 'this flow'}'? This action cannot be undone. All nodes and connections in this flow will be permanently deleted.`
})
const deleteDialogConfirmText = computed(() =>
  isBulkDelete.value ? `Delete ${multiSelectedFlowIds.value.size} Flows` : 'Delete Flow'
)

function openDeleteDialog(flow?: Partial<FlowEntity>) {
  if (multiSelectedFlowIds.value.size > 1) {
    targetFlow.value = null
    deleteDialogOpen.value = true
    return
  }
  if (!flow || flow.id === rootFlowId.value) return
  targetFlow.value = flow
  deleteDialogOpen.value = true
}

const handleUpdateLabel = (label: string) => {
  if (!targetFlow.value?.id || !label) return

  actor.send({ type: 'FLOW.UPDATE_LABEL', flowId: targetFlow.value.id, label })
  labelDialogOpen.value = false
  targetFlow.value = null
}

const handleConfirmDelete = () => {
  if (isBulkDelete.value) {
    for (const flowId of multiSelectedFlowIds.value) {
      actor.send({ type: 'FLOW.DELETE', flowId: flowId as EARS.EntityId })
    }
    clearMultiSelect()
    return
  }

  if (!targetFlow.value?.id) return
  actor.send({ type: 'FLOW.DELETE', flowId: targetFlow.value.id })
  targetFlow.value = null
}

const handleCancelDelete = () => targetFlow.value = null

async function handleExportFlowDSL(flow: Partial<FlowEntity>) {
  if (!flow.id) return
  const dir = await window.electronAPI?.fileUtils.selectPath({ type: 'directory' })
  if (!dir || typeof dir !== 'string') return
  actor.send({ type: 'DSL.RESET_EXPORT_STATUS' })
  actor.send({ type: 'DSL.EXPORT', directory: dir, flowId: flow.id })
}

function handleOverlayClick() {
  if (selectedFlowId.value) actor.send({ type: 'FLOW.SELECT', flowId: selectedFlowId.value })
}

function handleGoBack() {
  actor.send({ type: 'GO.BACK' })
}

async function handleLayout(direction?: LayoutDirection) {
  // Calculate new positions using async ELK layout
  const newPositions = await calculateLayoutAsync(
    { nodes: nodes.value, edges: edges.value },
    { direction }
  )

  // Save all positions to state
  for (const [nodeId, pos] of Object.entries(newPositions)) {
    actor.send({
      type: 'NODE.UPDATE_POSITION',
      nodeId,
      position: pos
    })
  }

  await nextTick()
  fitView()
}

async function handleNodesInitialized() {
  // Layout is calculated BEFORE render in XState actions (loadFlowData, addCreatedFlow)
  // This handler only needs to center the view
  await nextTick()
  fitView()
}

function handleNodeUpdate(nodeId: string, updates: Record<string, any>) {
  actor.send({ type: 'NODE.UPDATE', nodeId: nodeId as any, updates })
}

function handleReindexBranches(nodeId: string, data: { type: 'inserted' | 'removed'; index: number }) {
  actor.send({
    type: 'HANDLE.REINDEX',
    nodeId,
    prefix: 'branch',
    index: data.index,
    direction: data.type === 'inserted' ? 1 : -1,
  })
}

function handleNodeDragStop(event: NodeMouseEvent) {
  const node = event.node
  if (node.id && node.position) {
    actor.send({
      type: 'NODE.UPDATE_POSITION',
      nodeId: node.id,
      position: { x: node.position.x, y: node.position.y }
    })
  }
}

function handleNodesRemove(nodes: { id: string }[]) {
  for (const node of nodes) {
    actor.send({ type: 'NODE.DELETE', nodeId: node.id })
  }
}

function handleSelectionChange(changes: { id: string; selected: boolean }[]) {
  const selectedChange = changes.find(change => change.selected)
  const deselectedChange = changes.find(change => !change.selected)

  if (selectedChange) {
    actor.send({ type: 'NODE.SELECTION_CHANGE', nodeId: selectedChange.id, selected: true })
  } else if (deselectedChange) {
    actor.send({ type: 'NODE.SELECTION_CHANGE', nodeId: '', selected: false })
  }
}

function handleEdgesRemove(edges: { id: string }[]) {
  for (const edge of edges) {
    actor.send({ type: 'EDGE.DISCONNECT', edgeId: edge.id })
  }
}

function handleEdgeUpdate(event: EdgeUpdateEvent) {
  const { edge, connection } = event

  const moved = edge.source !== connection.source || edge.target !== connection.target
    || (edge.sourceHandle ?? null) !== (connection.sourceHandle ?? null)
    || (edge.targetHandle ?? null) !== (connection.targetHandle ?? null)
  if (moved) {
    actor.send({
      type: 'EDGE.RECONNECT',
      edgeId: edge.id,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
    })
  }
}

function handleEdgeUpdateEnd(event: EdgeMouseEvent) {
  // Vue Flow handles the visual state automatically
}
</script>

<style>

</style>
