import type { Ears, EngineSchema } from '@apackdev/ears';
import type { EARS } from '../types/entities.ts';
import { truncateResult } from '../steps/result-truncator.ts';
import { createLogger } from '../logger/logger.ts';

/** A run-history node's id: time-sortable, so a node's children and a flow's runs come back in the order they began */
export type RunNodeId = `RunNode-${string}`;

/** Where a run node is: running, finished, failed, or stopped by a kill, a restart or the app closing first */
export type RunStatus = 'active' | 'completed' | 'failed' | 'stopped';

/** What every run node has, whatever it ran */
export interface RunNodeBase {
  id: RunNodeId;
  label: string;
  status: RunStatus;
  startedAt: number;
  completedAt?: number;
  /** The node this one ran under: absent on a session's root */
  parentId?: RunNodeId;
  /** The session's root, which the whole tree is pruned with */
  rootId: RunNodeId;
  /** The flow whose nodes this run walks */
  flowId?: EARS.EntityId;
  /** The step, trigger or subflow node this one ran */
  nodeId?: EARS.EntityId;
  final?: boolean;
}

/** A flow run: a session's root, or a subflow a step started */
export interface FlowRunNode extends RunNodeBase {
  kind: 'flow';
  /** `subflow` for a flow a step started */
  stepNodeType?: string;
  /** What the subflow step was given (its settings, with its mappings applied), as recorded: bounded */
  input?: Record<string, unknown>;
  /** What the flow ended with */
  result?: unknown;
  eventType?: never; triggerType?: never; cronExpression?: never; payload?: never;
}

/** An event a flow run heard, which a track ran under */
export interface EventRunNode extends RunNodeBase {
  kind: 'event';
  eventType: string;
  /** The trigger that heard it: `listener`, `schedule`, ... */
  triggerType: string;
  cronExpression?: string;
  /** What the event carried, as recorded: bounded */
  payload?: unknown;
  stepNodeType?: never; input?: never; result?: never;
}

/** A step a track ran */
export interface StepRunNode extends RunNodeBase {
  kind: 'step';
  stepNodeType: string;
  /** What the step was given (its settings, with its mappings applied), as recorded: bounded */
  input?: Record<string, unknown>;
  /** What the step returned, or `{ error }` when it failed */
  result?: unknown;
  eventType?: never; triggerType?: never; cronExpression?: never; payload?: never;
}

/**
 * One node of a flow run's record: a flow, an event it heard, or a step it ran, told apart by `kind`. A run is a
 * tree of them under the session's root, linked by `parentId`. It is an entity of the run history's own database
 * (`services.runHistory`, the `runs` database), never one of the app's engine, and what it records is bounded for
 * display: nothing runs on it.
 */
export type RunNode = FlowRunNode | EventRunNode | StepRunNode;

/** A node as it starts: the run history gives it its id, its root, `active` and its start time */
export type RunNodeStart =
  | Omit<FlowRunNode, 'id' | 'rootId' | 'status' | 'startedAt' | 'completedAt'>
  | Omit<EventRunNode, 'id' | 'rootId' | 'status' | 'startedAt' | 'completedAt'>
  | Omit<StepRunNode, 'id' | 'rootId' | 'status' | 'startedAt' | 'completedAt'>;

/** What a running node's record may take: its details. Its identity and place are fixed when it starts, and `finish` ends it */
export interface RunNodePatch {
  label?: string;
  input?: Record<string, unknown>;
  payload?: unknown;
  result?: unknown;
}

/** A node with its children, each with theirs: one node's whole subtree */
export type RunTree = RunNode & { children: RunTree[] };

/** How a list of nodes is paged: oldest first unless `reverse`, resuming after `cursor` */
export interface RunPage {
  limit?: number;
  cursor?: RunNodeId;
  reverse?: boolean;
}

/**
 * The run history: every flow run's tree of nodes, appended while it runs and kept after it ends. It is in a database of
 * its own on purpose — a run is a log, never part of a unit of the user's data — so a write here is never undone by a
 * `transact` on the app's engine that throws, and none waits on one.
 */
export interface RunHistory {
  /**
   * Records a node starting now, under a new id that sorts after every one before, and returns it as stored. One
   * whose parent isn't in the history is returned but not recorded, and logged: a tree has no orphans.
   */
  start(node: RunNodeStart): RunNode;
  /** Ends a node now, completed or failed; an id with no node is ignored */
  finish(id: RunNodeId, status: 'completed' | 'failed'): void;
  /** Records a node's details: its label, attributes or result; an id with no node is ignored */
  update(id: RunNodeId, patch: RunNodePatch): void;
  get(id: RunNodeId): RunNode | undefined;
  /** A node's children, in the order they began */
  findChildren(id: RunNodeId, page?: RunPage): RunNode[];
  /** A node and every node under it, or undefined */
  tree(id: RunNodeId): RunTree | undefined;
  /** Flow nodes at any depth, newest first, of one flow when `flowId` is given */
  findRuns(options?: { flowId?: EARS.EntityId; limit?: number; cursor?: RunNodeId }): RunNode[];
  /** Marks every node still `active` as `stopped`: what is left of runs a kill, a restart or the app closing ended */
  stopActive(): void;
  /** Removes whole runs: every session tree whose root is not active and ended before `before`. Returns how many */
  prune(options: { before: number }): number;
}

const logger = createLogger('run-history');

/**
 * The values being written, made storable and bounded. Only those: a value stored earlier was bounded when it was
 * written, and bounding it again would wrap its marker in another. Storable is JSON's: what a run records is for
 * display, so a value JSON doesn't hold (`undefined`, a number that isn't finite) is left as JSON leaves it
 */
function bounded<T extends RunNodePatch>(fields: T): T {
  const json = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown);
  return json({
    ...fields,
    ...(fields.input !== undefined && { input: truncateResult(fields.input) as Record<string, unknown> }),
    ...(fields.payload !== undefined && { payload: truncateResult(fields.payload) }),
    ...(fields.result !== undefined && { result: truncateResult(fields.result) }),
  }) as T;
}

/**
 * @internal The run history's database's schema: one entity type, its nodes, with the fields every node holds and an
 * index for each way the history looks nodes up — a node's children, a session's nodes, by status and kind, and a
 * flow's runs
 */
export const _RUN_HISTORY_SCHEMA: EngineSchema = {
  types: {
    RunNode: {
      required: ['kind', 'label', 'status', 'startedAt', 'rootId'],
      indexes: ['parentId', 'rootId', 'status', 'kind', 'flowId'],
    },
  },
  relations: {},
  roles: [],
};

/** A clock for run node ids: base-36 time then a counter for those made in one millisecond, so ids sort as made */
function idClock(): () => RunNodeId {
  let lastTime = 0;
  let sameTime = 0;
  return () => {
    const now = Date.now();
    if (now > lastTime) { lastTime = now; sameTime = 0; } else sameTime++;
    return `RunNode-${lastTime.toString(36).padStart(9, '0')}${sameTime.toString(36).padStart(4, '0')}`;
  };
}

/**
 * The ids after `cursor` in id order (before it, read newest first), up to `limit`. Sorted here, since the order an
 * index answers in is the order ids were made in, which a clock set back between two runs of the app makes another
 */
function paged(ids: readonly RunNodeId[], { reverse = false, limit, cursor }: RunPage): RunNodeId[] {
  const sorted = [...ids].sort();
  const ordered = reverse ? sorted.reverse() : sorted;
  const after = cursor === undefined ? ordered : ordered.filter((id) => (reverse ? id < cursor : id > cursor));
  return limit === undefined ? [...after] : after.slice(0, limit);
}

/**
 * @internal The run history over the engine of its own database (`runs`): the host's on disk, a test's in a temporary
 * directory. Each node is a `RunNode` entity whose fields are the node's; nothing about the history is a unit of the
 * user's data, so no `transact` on the app's engine reaches it
 */
export function _createRunHistory(runs: Ears): RunHistory {
  const newId = idClock();
  const node = (id: RunNodeId) => runs.getRow(id as EARS.EntityId) as unknown as RunNode | undefined;
  /** The nodes with these ids, in the order given */
  const rows = (ids: readonly RunNodeId[]): RunNode[] =>
    ids.length === 0 ? [] : stripped(runs.query.ids(ids as unknown as readonly EARS.EntityId[]).pickAll());
  /** A row without the engine's own fields, which a node doesn't hold */
  const stripped = (found: readonly Record<string, unknown>[]): RunNode[] =>
    found.map(({ entityType: _type, createdAt: _created, updatedAt: _updated, ...fields }) => fields as unknown as RunNode);
  const where = (field: string, value: unknown): RunNodeId[] =>
    runs.query('RunNode').where(field, value as never).ids() as unknown as RunNodeId[];

  const history: RunHistory = {
    start(fields) {
      const id = newId();
      const parent = fields.parentId === undefined ? undefined : node(fields.parentId);
      const started = bounded({ ...fields, id, rootId: parent?.rootId ?? id, status: 'active', startedAt: Date.now() } as RunNode);
      if (fields.parentId !== undefined && !parent) {
        logger.warn(`Dropped run node ${id}: its parent ${fields.parentId} isn't in the run history`);
      } else {
        const { id: _id, ...row } = started;
        runs.create('RunNode', { ...row, id: id as unknown as EARS.EntityId });
      }
      return started;
    },
    finish(id, status) {
      if (node(id)) runs.write(id as unknown as EARS.EntityId).setMany({ status, completedAt: Date.now() });
    },
    update(id, patch) {
      if (node(id)) runs.write(id as unknown as EARS.EntityId).setMany(bounded(patch) as Record<string, unknown>);
    },
    get: (id) => (node(id) ? stripped([runs.getRow(id as unknown as EARS.EntityId)!])[0] : undefined),
    findChildren: (id, page = {}) => rows(paged(where('parentId', id), page)),
    tree(id) {
      const root = history.get(id);
      if (!root) return undefined;
      // A session's root is its whole session, read at once by the root every node files under. Any other node is
      // a part of one, read child by child: a session lasts as long as the brain, and reading all of it to show a
      // subflow or a page of events costs what the session holds, not what is shown
      if (root.id !== root.rootId) {
        const grow = (parent: RunNode): RunTree => ({ ...parent, children: history.findChildren(parent.id).map(grow) });
        return grow(root);
      }
      const childrenOf = new Map<string, RunNode[]>();
      for (const each of rows(where('rootId', root.rootId))) {
        if (each.parentId === undefined) continue;
        const siblings = childrenOf.get(each.parentId);
        if (siblings) siblings.push(each);
        else childrenOf.set(each.parentId, [each]);
      }
      const grow = (parent: RunNode): RunTree => ({ ...parent, children: (childrenOf.get(parent.id) ?? []).map(grow) });
      return grow(root);
    },
    findRuns: ({ flowId, limit, cursor } = {}) => {
      const flows = flowId === undefined
        ? where('kind', 'flow')
        : runs.query('RunNode').where('flowId', flowId).where('kind', 'flow').ids() as unknown as RunNodeId[];
      return rows(paged(flows, { reverse: true, limit, cursor }));
    },
    stopActive() {
      const now = Date.now();
      runs.transact(() => {
        for (const id of where('status', 'active')) runs.write(id as unknown as EARS.EntityId).setMany({ status: 'stopped', completedAt: now });
      });
    },
    prune({ before }) {
      let removed = 0;
      // A session's root is a flow node with no parent
      const roots = rows(runs.query('RunNode').where('kind', 'flow').lacks('parentId').ids() as unknown as RunNodeId[]);
      runs.transact(() => {
        for (const root of roots) {
          if (root.status === 'active' || (root.completedAt ?? root.startedAt) >= before) continue;
          for (const id of where('rootId', root.id)) runs.write(id as unknown as EARS.EntityId).destroy();
          removed++;
        }
      });
      return removed;
    },
  };
  return history;
}
