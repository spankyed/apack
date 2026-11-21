import { type Ears } from '@elmdb/ears';
import { boundEars } from '../../ears/index.ts';
import { createExportDir, ensureDirectoryExists, writeExportJson } from '../../utils/index.ts';
import type { StepDefinition } from '../../steps/index.ts';
import { stepLookup, type StepLookup } from './step-lookup.ts';
import type { FlowDSL, Track, DSLStepNode } from './flow-types.ts';
import { EARS } from '../../types/entities.ts';

interface DecompileGraphCtx {
  steps: StepLookup;
  nodes: any[];
  edges: any[];
  triggerNodeIds: Set<string>;
  inlinedNodeIds: Set<string>;
  incomingEdges: Map<string, string[]>;
  outgoingEdges: Map<string, string[]>;
  actionMap: Map<string, string>;
  promptMap: Map<string, string>;
  flowMap: Map<string, string>;
}

export interface ExportFlowsOptions {
  rootFlowRole: string;
  flowIds?: string[];
  /** The engine to read the flows from; the installed one by default */
  engine?: Ears;
  /** The step definitions to decompile with; the registered packs' by default */
  steps?: readonly StepDefinition[];
}

function getFlowNodes({ query }: Ears, steps: StepLookup, flowId: string): any[] {
  const nodeIds = query.ids(flowId as EARS.EntityId)
    .out(EARS.RelKind.CONTAINS, EARS.Entity.Node)
    .ids();

  const nodes = query.ids(nodeIds as EARS.EntityId[]).pickAll();

  return nodes.map((node: any) => {
    const rel = steps.getBuild(node.nodeType)?.relation;
    if (!rel) return node;
    const linkedId = query.ids(node.id as EARS.EntityId)
      .outEdges(EARS.RelKind.INSTANCE_OF)[0]?.target;
    return linkedId ? { ...node, [rel.field]: linkedId } : node;
  });
}

function getFlowEdges(engine: Ears, steps: StepLookup, flowId: string): any[] {
  const { query } = engine;
  const nodes = getFlowNodes(engine, steps, flowId);
  const nodeIds = nodes.map((n: any) => n.id).filter(Boolean);

  const edges: any[] = [];
  for (const source of nodeIds) {
    for (const edge of query.ids(source as EARS.EntityId).outEdges([EARS.RelKind.TRANSITIONS_TO], [EARS.Entity.Node])) {
      if (nodeIds.includes(edge.target)) edges.push({ ...edge, info: (edge.info as Record<string, unknown>) || {} });
    }
  }

  return edges;
}

/*─────────────────────────────────────────────────────────────────
 * Inline Branch Detection
 *─────────────────────────────────────────────────────────────────*/

function isExclusiveChain(
  startNodeId: string,
  sourceNodeId: string,
  graphCtx: DecompileGraphCtx,
): { exclusive: boolean; chain: string[] } {
  const { incomingEdges, outgoingEdges, triggerNodeIds } = graphCtx;

  const chain: string[] = [];
  let current = startNodeId;
  let prevId = sourceNodeId;

  while (true) {
    if (triggerNodeIds.has(current)) break;

    const incoming = incomingEdges.get(current) || [];
    if (incoming.length !== 1 || incoming[0] !== prevId) {
      return { exclusive: false, chain: [] };
    }

    chain.push(current);

    const outgoing = outgoingEdges.get(current) || [];
    if (outgoing.length !== 1) break;

    const nextId = outgoing[0];
    if (chain.includes(nextId)) break;
    if (triggerNodeIds.has(nextId)) break;

    prevId = current;
    current = nextId;
  }

  return { exclusive: chain.length > 0, chain };
}

function decompileChain(
  chain: string[],
  graphCtx: DecompileGraphCtx,
): DSLStepNode[] {
  return chain.map(nodeId => {
    graphCtx.inlinedNodeIds.add(nodeId);
    const node = graphCtx.nodes.find((n: any) => n.id === nodeId)!;
    return decompileStepNode(node, graphCtx);
  });
}

/*─────────────────────────────────────────────────────────────────
 * Step Node Decompilation
 *─────────────────────────────────────────────────────────────────*/

function resolveBranch(
  sourceNodeId: string,
  sourceHandle: string,
  graphCtx: DecompileGraphCtx,
): DSLStepNode[] | null {
  const sourceEdges = graphCtx.edges.filter((e: any) => e.source === sourceNodeId);

  let branchEdge = sourceEdges.find(
    (e: any) => (e.info as any)?.sourceHandle === sourceHandle
  );
  if (!branchEdge) {
    const matchedTargets = new Set(
      sourceEdges
        .filter((e: any) => (e.info as any)?.sourceHandle)
        .map((e: any) => e.target)
    );
    branchEdge = sourceEdges.find((e: any) => !matchedTargets.has(e.target));
  }

  if (!branchEdge) return null;

  const { exclusive, chain } = isExclusiveChain(
    branchEdge.target, sourceNodeId, graphCtx
  );
  if (exclusive && chain.length > 0) {
    return decompileChain(chain, graphCtx);
  }
  const targetNode = graphCtx.nodes.find((n: any) => n.id === branchEdge!.target);
  if (targetNode) {
    graphCtx.inlinedNodeIds.add(targetNode.id as string);
    return [decompileStepNode(targetNode, graphCtx)];
  }
  return null;
}

function decompileStepNode(
  node: any,
  graphCtx: DecompileGraphCtx,
): DSLStepNode {
  const build = graphCtx.steps.getBuild(node.nodeType);
  if (build?.decompile) {
    return build.decompile(node, {
      actionMap: graphCtx.actionMap,
      promptMap: graphCtx.promptMap,
      flowMap: graphCtx.flowMap,
      resolveBranch: (sourceId, handle) =>
        resolveBranch(sourceId, handle, graphCtx) as unknown as Record<string, unknown>[] | null,
    }) as unknown as DSLStepNode;
  }
  console.warn(`No decompile for node type: ${node.nodeType}`);
  return { type: node.nodeType, label: node.label } as any;
}

/*─────────────────────────────────────────────────────────────────
 * Track Reconstruction
 *─────────────────────────────────────────────────────────────────*/

function buildTracksFromGraph(
  steps: StepLookup,
  nodes: any[],
  edges: any[],
  actionMap: Map<string, string>,
  promptMap: Map<string, string>,
  flowMap: Map<string, string>,
): Track[] {
  const allTriggerNodes = nodes.filter((n: any) => steps.isTrigger(n.nodeType));

  const incomingEdges = new Map<string, string[]>();
  const outgoingEdges = new Map<string, string[]>();
  for (const edge of edges) {
    const sources = incomingEdges.get(edge.target) || [];
    sources.push(edge.source);
    incomingEdges.set(edge.target, sources);

    const targets = outgoingEdges.get(edge.source) || [];
    targets.push(edge.target);
    outgoingEdges.set(edge.source, targets);
  }

  const triggerNodeIds = new Set(allTriggerNodes.map((n: any) => n.id as string));

  const graphCtx: DecompileGraphCtx = {
    steps,
    nodes,
    edges,
    triggerNodeIds,
    inlinedNodeIds: new Set(),
    incomingEdges,
    outgoingEdges,
    actionMap,
    promptMap,
    flowMap,
  };

  const tracks: Track[] = [];
  const usedLabels = new Set<string>();

  function buildExits(triggerNodeId: string): DSLStepNode[][] {
    const triggerEdges = edges.filter((e: any) => e.source === triggerNodeId);

    const sortedExitEdges = [...triggerEdges].sort((a, b) => {
      const aIdx = parseInt(((a.info as any)?.sourceHandle || 'exit-0').replace('exit-', ''));
      const bIdx = parseInt(((b.info as any)?.sourceHandle || 'exit-0').replace('exit-', ''));
      return aIdx - bIdx;
    });

    const exits: DSLStepNode[][] = [];
    for (const exitEdge of sortedExitEdges) {
      const chainSteps: any[] = [];
      const visited = new Set<string>();
      function followChain(nodeId: string) {
        if (visited.has(nodeId) || triggerNodeIds.has(nodeId)) return;
        visited.add(nodeId);
        const node = nodes.find((n: any) => n.id === nodeId);
        if (!node) return;
        chainSteps.push(node);
        const targets = outgoingEdges.get(nodeId) || [];
        for (const t of targets) followChain(t);
      }
      followChain(exitEdge.target as string);

      const pairs = chainSteps.map((step: any) => ({
        nodeId: step.id as string,
        dsl: decompileStepNode(step, graphCtx),
      }));
      const dslSteps = pairs
        .filter(p => !graphCtx.inlinedNodeIds.has(p.nodeId))
        .map(p => p.dsl);
      exits.push(dslSteps);
    }

    if (exits.length === 0) exits.push([]);
    return exits;
  }

  function uniqueLabel(label: string): string {
    let unique = label;
    let counter = 2;
    while (usedLabels.has(unique)) {
      unique = `${label} ${counter}`;
      counter++;
    }
    usedLabels.add(unique);
    return unique;
  }

  for (const triggerNode of allTriggerNodes) {
    const triggerFacet = steps.getTrigger(triggerNode.nodeType);
    if (!triggerFacet?.decompile) continue;

    const trackFields = triggerFacet.decompile(triggerNode as unknown as Record<string, unknown>);
    const track: Track = {
      ...trackFields,
      exits: buildExits(triggerNode.id as string),
    } as Track;

    track.label = uniqueLabel(triggerNode.label || triggerNode.nodeType);

    if (triggerNode.description) {
      track.description = triggerNode.description;
    }

    tracks.push(track);
  }

  return tracks;
}

/*─────────────────────────────────────────────────────────────────
 * Flow Decompilation
 *─────────────────────────────────────────────────────────────────*/

function decompileFlow(
  engine: Ears,
  steps: StepLookup,
  flow: any,
  actionMap: Map<string, string>,
  promptMap: Map<string, string>,
  flowMap: Map<string, string>,
): { name: string; tracks: Track[] } {
  const nodes = getFlowNodes(engine, steps, flow.id);
  const edges = getFlowEdges(engine, steps, flow.id);
  const tracks = buildTracksFromGraph(steps, nodes, edges, actionMap, promptMap, flowMap);
  return { name: flow.label, tracks };
}

/*─────────────────────────────────────────────────────────────────
 * Main Export Function
 *─────────────────────────────────────────────────────────────────*/

export function exportFlowsToDSL(
  outputDir: string,
  options: ExportFlowsOptions,
  versioned = true,
): { filePath: string; flowCount: number; skipped: string[] } {
  const { rootFlowRole, flowIds, engine = boundEars() } = options;
  const { query } = engine;
  const steps = stepLookup(options.steps);

  const actions = query(EARS.Entity.Action).pickAll() as any[];
  const prompts = query(EARS.Entity.Prompt).pickAll() as any[];

  const actionMap = new Map<string, string>();
  for (const action of actions) actionMap.set(action.id, action.label);

  const promptMap = new Map<string, string>();
  for (const prompt of prompts) promptMap.set(prompt.id, prompt.label);

  let flows = query(EARS.Entity.Flow).pickAll() as any[];
  if (flowIds) {
    const idSet = new Set(flowIds);
    flows = flows.filter((f: any) => idSet.has(f.id));
  }

  const flowMap = new Map<string, string>();
  for (const flow of flows) flowMap.set(flow.id, flow.label);

  const rootFlowId = query.all().withRole(rootFlowRole).first();

  const dsl: FlowDSL = {};
  const skipped: string[] = [];
  let exported = 0;

  for (const flow of flows) {
    const { name, tracks } = decompileFlow(engine, steps, flow, actionMap, promptMap, flowMap);
    // A flow with no trigger has no track to hang its steps from, and the DSL has no way to say "a flow that
    // does nothing yet" — so it cannot be exported. It is named rather than dropped: a flow the user built and
    // has not triggered yet would otherwise be missing from the file with nothing said.
    if (tracks.length === 0) { skipped.push(name); continue; }

    if (flow.id === rootFlowId) {
      dsl[name] = { root: true, tracks };
    } else {
      dsl[name] = tracks;
    }
    exported++;
  }

  if (versioned) {
    outputDir = createExportDir(outputDir, 'flows');
  } else {
    ensureDirectoryExists(outputDir);
  }
  const filePath = writeExportJson(outputDir, 'exported-flows.json', dsl);

  return { filePath, flowCount: exported, skipped };
}
