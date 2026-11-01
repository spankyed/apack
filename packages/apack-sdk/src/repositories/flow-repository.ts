// The flow model's repository: flows, their nodes and the edges between them, and the root flow role.
// The SDK declares these entities (sdk-entities.ts), so it owns their reads and writes; packs build
// their views on top (default-setup's flows repository).
import { getTimestamp, RESERVED_ATTRIBUTES } from '@apackdev/ears';
import { RepositoryError, RepositoryErrorCode } from './repository-error.ts';
import { findRelations, nextLabel, getRow, getRoles, updateRelation, removeRelation, untypedCreate, untypedWrite, untypedQuery as query, transact } from '../ears/index.ts';
import { EARS } from '../types/entities.ts';
import type { FlowEntity, NodeBase } from '../types/sdk-entities.ts';
import type { CompiledRows } from '../build/compilers/flow-compiler.ts';
import { stepRegistry } from '../steps/registry.ts';
import { getStepBinding, getStepDeclaration, type StepBackendBinding } from '../steps/catalog.ts';
import { createLogger } from '../logger/logger.ts';

const logger = createLogger('flows-repository');

/** A Node row: the fields every node has, and its step's own */
export type FlowNode = NodeBase & Record<string, unknown>;

/** What a node is created or updated with: its fields, and for a step with a relation (`action`, `llm`) the id it names */
export type FlowNodeInput = Partial<NodeBase> & Record<string, unknown>;

/** A transition between two of a flow's nodes: the relation's id, and the handles it leaves and enters by */
export interface FlowEdge {
  id: EARS.EntityId;
  kind: EARS.RelKind;
  source: EARS.EntityId;
  target: EARS.EntityId;
  sourceHandle?: string;
  targetHandle?: string;
  info?: Record<string, unknown>;
}

/** The relation kinds a flow's interior is made of: the flow holding its nodes, their edges, a node's related entity */
const INTERIOR_KINDS: readonly string[] = [EARS.RelKind.CONTAINS, EARS.RelKind.TRANSITIONS_TO, EARS.RelKind.INSTANCE_OF];

/** One relation, as the import compares it: its ends, kind and info, an empty info being none */
const relationKey = (source: string, kind: string, target: string, info: unknown) => {
  const held = info && typeof info === 'object' && Object.keys(info).length === 0 ? null : info;
  return JSON.stringify([source, kind, target, held ?? null]);
};

/** The fields only the engine writes, which an import neither rewrites nor removes */
const ENGINE_FIELDS: ReadonlySet<string> = new Set(RESERVED_ATTRIBUTES);

/**
 * Writes an imported row: a new entity as the file has it; one already there, only the declared fields whose
 * value differs, leaving its identity and every field the file doesn't declare as they were — except a node whose
 * step type changed, which keeps its id (the id follows the label and position) but none of its old step's fields.
 */
function writeDeclared(row: { id: EARS.EntityId; entityType: string } & Record<string, unknown>): void {
  const { id, entityType, createdAt, ...fields } = row;
  if (!query.ids(id).exists()) {
    untypedCreate(entityType, { ...fields, id, createdAt: createdAt as number | undefined });
    return;
  }
  const current: Record<string, unknown> = getRow(id) ?? {};
  if ('nodeType' in fields && current.nodeType !== fields.nodeType) {
    for (const field of Object.keys(current)) {
      if (!(field in fields) && !ENGINE_FIELDS.has(field)) untypedWrite(id).delete(field);
    }
  }
  const changed = Object.fromEntries(Object.entries(fields)
    .filter(([field, value]) => !ENGINE_FIELDS.has(field) && JSON.stringify(current[field]) !== JSON.stringify(value)));
  if (Object.keys(changed).length > 0) untypedWrite(id).setMany(changed);
}


const EDGE_KINDS: readonly string[] = [EARS.RelKind.TRANSITIONS_TO];

const NODE_DEFAULTS = { TYPE: 'action', LABEL: 'New Node', DESCRIPTION: '' } as const;
const FLOW_DEFAULTS = { TYPE: 'workflow', DESCRIPTION: '' } as const;

type Handles = { sourceHandle?: string; targetHandle?: string };

function handlesMatch(info: unknown, options?: Handles): boolean {
  const handles = info as Handles | undefined;
  return (handles?.sourceHandle || undefined) === (options?.sourceHandle || undefined)
    && (handles?.targetHandle || undefined) === (options?.targetHandle || undefined);
}

/**
 * An edge's stored info: its handles, kept for steps with several outputs (switch), each only when it names one. They
 * are `transitions_to`'s key, so a handle left out is null, the same identity as an edge with no info
 */
const handleInfo = (handles?: Handles): Handles | undefined =>
  handles?.sourceHandle || handles?.targetHandle
    ? { ...(handles.sourceHandle && { sourceHandle: handles.sourceHandle }), ...(handles.targetHandle && { targetHandle: handles.targetHandle }) }
    : undefined;

/**
 * Throws unless an edge from `sourceId` to `targetId` with these handles may exist: a trigger receives none, the
 * same edge isn't there twice, and a non-trigger's source handle has one outgoing edge. `except` is an edge being moved.
 */
function assertEdgeAllowed(sourceId: EARS.EntityId, targetId: EARS.EntityId, handles?: Handles, except?: EARS.RelationId): void {
  const isTrigger = (id: EARS.EntityId) => {
    const nodeType = query.ids(id).pickOne(['nodeType'])?.nodeType;
    return typeof nodeType === 'string' && getStepDeclaration(nodeType)?.declaration.kind === 'trigger';
  };
  if (isTrigger(targetId)) {
    throw new RepositoryError('Trigger nodes cannot receive incoming connections', RepositoryErrorCode.VALIDATION_ERROR);
  }

  const existing = findRelations({ source: sourceId, kind: EARS.RelKind.TRANSITIONS_TO }).filter((rel) => rel.id !== except);
  if (existing.some((rel) => rel.target === targetId && handlesMatch(rel.info, handles))) {
    throw new RepositoryError('Edge already exists', RepositoryErrorCode.VALIDATION_ERROR);
  }
  if (!isTrigger(sourceId)) {
    const occupied = existing.some((rel) => {
      const handle = (rel.info as Handles | undefined)?.sourceHandle;
      return handles?.sourceHandle ? handle === handles.sourceHandle : !handle;
    });
    if (occupied) {
      throw new RepositoryError('Source handle already has an outgoing connection', RepositoryErrorCode.VALIDATION_ERROR);
    }
  }
}

function requireStepBinding(nodeType: string): StepBackendBinding {
  const accepted = getStepBinding(nodeType);
  if (!accepted) throw new RepositoryError(
    `Step "${nodeType}" has no active backend matching its current declarations`, RepositoryErrorCode.VALIDATION_ERROR,
  );
  return accepted;
}

/** Validate with the accepted provider, then recheck eligibility before any row or relation write. */
function validateNode(node: FlowNode, accepted: StepBackendBinding): void {
  const nodeType = accepted.binding.type;
  const result = accepted.binding.trigger?.validate?.(node);
  if (result && !result.valid) {
    throw new RepositoryError(`Invalid ${node.nodeType} node: ${result.errors.join(', ')}`, RepositoryErrorCode.VALIDATION_ERROR);
  }
  if (node.nodeType !== nodeType) {
    throw new RepositoryError('A node\'s type cannot be changed', RepositoryErrorCode.VALIDATION_ERROR);
  }
  const current = getStepBinding(nodeType);
  if (!current || current.registrationId !== accepted.registrationId || current.packId !== accepted.packId) {
    throw new RepositoryError(`Step "${nodeType}" backend changed while validating the node`, RepositoryErrorCode.VALIDATION_ERROR);
  }
}

/** The field a step names its related entity by (`actionId`), from its build facet */
const relationField = (nodeType: string): string | undefined => getStepDeclaration(nodeType)?.declaration.build?.relation?.field;

/** A node's input split into its related entity's id (when the input names one) and its own fields */
function splitRelation(input: FlowNodeInput, field: string | undefined): { related: Record<string, unknown>; fields: FlowNodeInput } {
  if (!field || !(field in input)) return { related: {}, fields: input };
  const { [field]: relatedId, ...fields } = input;
  return { related: { [field]: relatedId }, fields };
}

/** The node with its related entity's id under the step's relation field */
function withRelation(node: FlowNode): FlowNode {
  const field = relationField(node.nodeType);
  if (!field) return node;
  const linkedId = query.ids(node.id).out(EARS.RelKind.INSTANCE_OF).first();
  return linkedId ? { ...node, [field]: linkedId } : node;
}

const flowNodeIds = (flowId: EARS.EntityId): EARS.EntityId[] =>
  query.ids(flowId).out(EARS.RelKind.CONTAINS, EARS.Entity.Node).ids();

/** Reads and writes of flows, their nodes and edges, and the root flow role */
export const flowRepository = {
  // ── Queries ──────────────────────────────────────────────────────────

  /** The flow with the root role */
  rootFlow: (): EARS.EntityId | undefined => query.all().withRole(EARS.RoleKind.ROOT_FLOW).first() ?? undefined,

  /** The action an action node runs */
  getNodeActionId: (nodeId: EARS.EntityId): EARS.EntityId | undefined =>
    query.ids(nodeId).out(EARS.RelKind.INSTANCE_OF, EARS.Entity.Action).first(),

  /** A node with all its fields, and its related entity's id */
  node: (nodeId: EARS.EntityId): FlowNode | undefined => {
    const [node] = query.ids(nodeId).pickAll() as unknown as FlowNode[];
    return node ? withRelation(node) : undefined;
  },

  /** A flow's nodes, each with its related entity's id */
  flowNodes: (flowId: EARS.EntityId): FlowNode[] =>
    (query.ids(flowNodeIds(flowId)).pickAll() as unknown as FlowNode[]).map(withRelation),

  /** The transitions between a flow's nodes */
  flowEdges: (flowId: EARS.EntityId): FlowEdge[] => {
    const nodeIds = flowNodeIds(flowId);
    const edges: FlowEdge[] = [];
    // Each relation once, so two edges between the same nodes on different handles are two edges
    for (const source of nodeIds) {
      for (const details of findRelations({ source })) {
        if (!EDGE_KINDS.includes(details.kind) || !nodeIds.includes(details.target)) continue;
        const handles = details.info as Handles | undefined;
        edges.push({
          id: details.id, kind: details.kind, source, target: details.target,
          sourceHandle: handles?.sourceHandle, targetHandle: handles?.targetHandle, info: {},
        });
      }
    }
    return edges;
  },

  // ── Flows ────────────────────────────────────────────────────────────

  createFlow: (flow?: Partial<FlowEntity>): FlowEntity => {
    const ts = getTimestamp();
    const fields = {
      // A subflow names its flow by label, so a default one must be unique
      label: flow?.label || nextLabel(EARS.Entity.Flow, 'New Flow'),
      description: flow?.description || FLOW_DEFAULTS.DESCRIPTION,
      flowType: flow?.flowType || FLOW_DEFAULTS.TYPE,
    };
    // `create` numbers its short code
    const id = untypedCreate(EARS.Entity.Flow, { ...fields, createdAt: ts }).id();
    return getRow(id) as unknown as FlowEntity;
  },

  updateFlowLabel: (flowId: EARS.EntityId, label: string): void => {
    untypedWrite(flowId).set('label', label);
  },

  /** Deletes a flow with its nodes and their edges; the root flow only with `allowRoot` */
  deleteFlow: (flowId: EARS.EntityId, options?: { allowRoot?: boolean }): void => {
    const isRoot = query.ids(flowId).withRole(EARS.RoleKind.ROOT_FLOW).first();
    if (isRoot && !options?.allowRoot) {
      throw new RepositoryError('Cannot delete the root flow', RepositoryErrorCode.OPERATION_FAILED);
    }
    if (isRoot) untypedWrite(flowId).revoke(EARS.RoleKind.ROOT_FLOW);

    const nodeIds = flowNodeIds(flowId);
    for (const nodeId of nodeIds) {
      try {
        flowRepository.deleteNode(nodeId);
      } catch (error) {
        logger.warn('Error deleting node during flow deletion', { nodeId, error });
      }
    }
    // Its own relations go with it
    untypedWrite(flowId).destroy();
    logger.info('Deleted flow and all its contents', { flowId, deletedNodes: nodeIds.length });
  },

  /** Makes a flow the root flow, taking the role from the previous one */
  grantRootFlowRole: (flowId: EARS.EntityId): void => {
    untypedWrite(flowId).grantExclusive(EARS.RoleKind.ROOT_FLOW, query.all().withRole(EARS.RoleKind.ROOT_FLOW).ids());
  },

  revokeRootFlowRole: (flowId: EARS.EntityId): void => {
    untypedWrite(flowId).revoke(EARS.RoleKind.ROOT_FLOW);
  },

  /**
   * Writes compiled flow DSL (`compileFlowDSL`) by reconciling: each flow it names ends as the file describes it,
   * changed in place, in one unit that lands entirely or not at all.
   *
   * **The file owns a flow's interior and nothing that points into it.** The interior is what the file writes —
   * the flow's own fields, its nodes, and the relations leaving them (`INTERIOR_KINDS`, plus any kind the file
   * emits). Everything else is the database's and survives by construction: a link from another entity (a run's
   * RunNode, another flow's subflow), the flow's fields the file doesn't declare (a content key, a user's
   * description), and its roles. So identity is kept — a flow or node the file still declares keeps its id, and
   * so does each relation it keeps — a node the file dropped goes with its edges, and importing the same file
   * twice changes nothing.
   *
   * Roles are granted, never revoked, on a flow: `root: true` makes it the root flow, and a file that doesn't say
   * so has expressed no choice about which flow is root. A node's roles are the file's, being interior.
   */
  importFromDSL: (compiled: CompiledRows): { flowIds: EARS.EntityId[] } => transact(() => {
    const rows = new Map(compiled.entity.map((entity) => {
      const row = entity as { id: EARS.EntityId; entityType: string } & Record<string, unknown>;
      return [row.id, row] as const;
    }));
    const flowIds = [...rows.values()].filter((row) => row.entityType === EARS.Entity.Flow).map((row) => row.id);
    for (const relation of compiled.relation) {
      if (!rows.has(relation.source as EARS.EntityId)) {
        throw new RepositoryError(`The import links from ${relation.source}, which it doesn't write`, RepositoryErrorCode.VALIDATION_ERROR);
      }
    }

    // Nodes a flow holds now and the file no longer declares go, with their edges
    const declared = new Set(compiled.relation.filter((r) => r.kind === EARS.RelKind.CONTAINS).map((r) => r.target));
    for (const flowId of flowIds) {
      if (!query.ids(flowId).exists()) continue;
      for (const nodeId of flowNodeIds(flowId)) {
        if (!declared.has(nodeId)) flowRepository.deleteNode(nodeId);
      }
    }

    for (const row of rows.values()) writeDeclared(row);

    // The relations leaving what the file writes, of the kinds it owns, are exactly the file's
    const owned = new Set([...INTERIOR_KINDS, ...compiled.relation.map((r) => r.kind)]);
    const wanted = new Set(compiled.relation.map((r) => relationKey(r.source, r.kind, r.target, r.info)));
    for (const id of rows.keys()) {
      for (const details of findRelations({ source: id })) {
        const key = relationKey(details.source, details.kind, details.target, details.info);
        if (owned.has(details.kind) && !wanted.has(key)) removeRelation(details.id);
      }
    }
    for (const relation of compiled.relation) {
      untypedWrite(relation.source as EARS.EntityId).link(relation.kind, relation.target as EARS.EntityId, { info: relation.info });
    }

    const rolesOf = (id: string) => compiled.role.filter((role) => role.entityId === id).map((role) => role.role);
    for (const row of rows.values()) {
      if (row.entityType === EARS.Entity.Flow) continue;
      const keep = rolesOf(row.id);
      for (const role of getRoles(row.id)) if (!keep.includes(role)) untypedWrite(row.id).revoke(role);
    }
    for (const role of compiled.role) {
      if (role.role === EARS.RoleKind.ROOT_FLOW) flowRepository.grantRootFlowRole(role.entityId as EARS.EntityId);
      else untypedWrite(role.entityId as EARS.EntityId).grant(role.role);
    }
    logger.info('Imported DSL flows', {
      entityCount: compiled.entity.length,
      relationCount: compiled.relation.length,
      roleCount: compiled.role.length,
      flowIds,
    });
    return { flowIds };
  }),

  // ── Nodes ────────────────────────────────────────────────────────────

  /** Adds a node to a flow, with its step's defaults under the given fields */
  createNode: (flowId: EARS.EntityId, input: FlowNodeInput): FlowNode => {
    const ts = getTimestamp();
    const nodeType = input.nodeType || NODE_DEFAULTS.TYPE;
    const accepted = requireStepBinding(nodeType);
    const defaults = stepRegistry.createNodeDefaults(nodeType) as Partial<NodeBase>;
    const field = accepted.binding.build?.relation?.field;
    const { related, fields } = splitRelation(input, field);
    const row = {
      ...defaults,
      ...fields,
      label: fields.label || defaults.label || NODE_DEFAULTS.LABEL,
      description: fields.description || defaults.description || NODE_DEFAULTS.DESCRIPTION,
      entityType: EARS.Entity.Node,
      nodeType,
      createdAt: ts,
      updatedAt: ts,
    };
    validateNode(row as FlowNode, accepted);

    const { entityType: _type, createdAt: _created, updatedAt: _updated, ...fieldsToWrite } = row;
    const nodeId = untypedCreate(EARS.Entity.Node, { ...fieldsToWrite, createdAt: ts }).id();
    untypedWrite(flowId).link(EARS.RelKind.CONTAINS, nodeId);
    const relatedId = field && related[field];
    if (relatedId) untypedWrite(nodeId).link(EARS.RelKind.INSTANCE_OF, relatedId as EARS.EntityId);
    return { id: nodeId, ...row } as FlowNode;
  },

  /** Updates a node's fields, and its related entity when the step's relation field is given */
  updateNode: (nodeId: EARS.EntityId, updates: FlowNodeInput): void => {
    const ts = getTimestamp();
    const [current] = query.ids(nodeId).pickAll() as unknown as FlowNode[];
    if (!current) throw new RepositoryError(`Node ${nodeId} not found`, RepositoryErrorCode.NOT_FOUND);
    if (updates.nodeType !== undefined && updates.nodeType !== current.nodeType) {
      throw new RepositoryError('A node\'s type cannot be changed', RepositoryErrorCode.VALIDATION_ERROR);
    }
    const owner = getStepDeclaration(current.nodeType);
    if (!owner) throw new RepositoryError(`Step "${current.nodeType}" has no declaration for editing`, RepositoryErrorCode.VALIDATION_ERROR);

    const field = owner.declaration.build?.relation?.field;
    const { related, fields } = splitRelation(updates, field);
    // The fields a node's edit may write: none the engine owns, and none it leaves undefined
    const changed = Object.fromEntries(Object.entries(fields)
      .filter(([key, value]) => value !== undefined && !(RESERVED_ATTRIBUTES as readonly string[]).includes(key)));
    if (owner.declaration.trigger?.validate) {
      validateNode({ ...current, ...changed, updatedAt: ts } as FlowNode, requireStepBinding(current.nodeType));
    }

    if (field && field in related) {
      const relatedId = related[field];
      untypedWrite(nodeId).unlink(EARS.RelKind.INSTANCE_OF);
      if (relatedId) untypedWrite(nodeId).set(field, relatedId).link(EARS.RelKind.INSTANCE_OF, relatedId as EARS.EntityId);
      else untypedWrite(nodeId).delete(field);
    }

    untypedWrite(nodeId).setMany(changed);
  },

  /**
   * Deletes a node with every relation to or from it — its edges, its flow's link to it and its related entity's
   * link — which destroying it removes; a run's record of the node is kept in the run history's partition
   */
  deleteNode: (nodeId: EARS.EntityId): void => {
    const inAFlow = (query(EARS.Entity.Flow).ids() as EARS.EntityId[]).some((id) => flowNodeIds(id).includes(nodeId));
    if (!inAFlow) throw new RepositoryError(`Node ${nodeId} not found in any flow`, RepositoryErrorCode.NOT_FOUND);
    untypedWrite(nodeId).destroy();
  },

  // ── Edges ────────────────────────────────────────────────────────────

  /**
   * Connects two nodes. A trigger can't be a target, an identical edge can't be added twice, and a
   * non-trigger's handle has at most one outgoing edge.
   */
  createEdge: (sourceId: EARS.EntityId, targetId: EARS.EntityId, options?: Handles): { relId: EARS.RelationId } => {
    assertEdgeAllowed(sourceId, targetId, options);
    untypedWrite(sourceId).link(EARS.RelKind.TRANSITIONS_TO, targetId, { info: handleInfo(options) });

    const relId = findRelations({ source: sourceId, kind: EARS.RelKind.TRANSITIONS_TO, target: targetId })
      .find((rel) => handlesMatch(rel.info, options))?.id;
    if (!relId) throw new RepositoryError('Failed to retrieve created edge ID', RepositoryErrorCode.OPERATION_FAILED);
    return { relId };
  },

  deleteEdge: (edgeId: EARS.RelationId): void => {
    removeRelation(edgeId);
  },

  /** Moves an edge to new ends and handles, keeping its id; throws, leaving it as it was, when that edge isn't allowed */
  updateEdge: (edgeId: EARS.RelationId, next: { source: EARS.EntityId; target: EARS.EntityId } & Handles): void => {
    assertEdgeAllowed(next.source, next.target, next, edgeId);
    updateRelation(edgeId, { source: next.source, target: next.target, info: handleInfo(next) ?? {} });
  },

  /**
   * Renumbers a node's `<prefix>-<n>` source handles around `pivotIndex`: inserting (direction 1) shifts
   * the handles at and after it up, removing (-1) shifts those after it down
   */
  reindexHandles: (nodeId: EARS.EntityId, prefix: string, pivotIndex: number, direction: 1 | -1): void => {
    const pattern = new RegExp(`^${prefix}-(\\d+)$`);
    const threshold = direction === 1 ? pivotIndex : pivotIndex + 1;
    const shifted = findRelations({ source: nodeId, kind: EARS.RelKind.TRANSITIONS_TO }).flatMap((rel) => {
      const info = rel.info as { sourceHandle?: string } | undefined;
      const match = info?.sourceHandle?.match(pattern);
      const index = match ? parseInt(match[1], 10) : -1;
      return index >= threshold ? [{ rel, info, index }] : [];
    });
    // Handles are the edges' identity, so each moves onto one already moved off: the highest first going up, the
    // lowest first going down
    shifted.sort((a, b) => (b.index - a.index) * direction);
    for (const { rel, info, index } of shifted) {
      updateRelation(rel.id, { info: { ...info, sourceHandle: `${prefix}-${index + direction}` } });
    }
  },
};
