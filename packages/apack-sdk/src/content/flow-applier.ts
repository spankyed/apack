import { flowRepository } from '../repositories/flow-repository.ts';
import { promptRepository } from '../repositories/prompt-repository.ts';
import { findRelations, boundEars as ears, untypedWrite } from '../ears/index.ts';
import { sdkEntities } from '../ears/sdk-entities.ts';
import { loadJSON, selectsAll, type ContentApplier, type ApplyContext, type ApplyResult, type AppliedItem } from '../utils/index.ts';
import { contentPath } from '../build/manifest.ts';
import { compile as compileFlowDSL } from '../build/compilers/flow-compiler.ts';
import { validate } from '../build/compilers/flow-dsl-validator.ts';
import { isFlowConfig, type FlowDSL } from '../build/compilers/flow-types.ts';
import { EARS } from '../types/entities.ts';
import { SDK_SHORT_CODES, type FlowEntity } from '../types/sdk-entities.ts';
import type { ContentEditPolicy } from '../framework/declaration-schema.ts';
import { childContentKey, contentKeyOf, defineKey, hashValues, recordApplied, CONTENT_KEY, contentKeyPrefix, CONTENT_HASH } from './format-applier.ts';
import { resolve, resolveRemoval, type LiveEntity } from './merge.ts';
import { contentPackId } from '../utils/apply.ts';

/**
 * What a flow's parts are **not** over: an entity's own id, when it was written and last changed, and the two attributes the
 * apply stamps on it. Everything else a flow or one of its nodes holds is content.
 */
const ROW_KEYS = new Set(['id', 'createdAt', 'updatedAt', 'contentHash', 'contentKey']);

/**
 * The relation kinds a flow's structure is made of. `flow-compiler.ts` emits these two and no others, which
 * `tests/content/flow-applier.spec.ts` holds against its output, so filtering to them is what keeps a flow's
 * `edges` part about the flow rather than about whatever a running app later links from one of its nodes.
 */
export const GRAPH_REL_KINDS: readonly string[] = [EARS.RelKind.CONTAINS, EARS.RelKind.TRANSITIONS_TO];

/** A flow's three parts as stored now: its own values, each node's, and its edges */
type GraphState = [Array<[string, unknown]>, Array<[string, Array<[string, unknown]>]>, string[]];

/** An entity's content as stored now: every attribute but the five that say which or when */
function contentOf(id: EARS.EntityId): Array<[string, unknown]> {
  const row = ears().query.withTrashed.ids(id).pickAll()[0] as Record<string, unknown> | undefined;
  return Object.entries(row ?? {}).filter(([field]) => !ROW_KEYS.has(field)).sort(([a], [b]) => (a < b ? -1 : 1));
}

/**
 * The flow's rows as stored now, independent of relation order.
 *
 * **It reads the entities rather than a recorded list of their fields**, which is what makes the apply that
 * wrote a flow and the apply that reads it back agree by construction: both ask the database the same
 * question a moment apart. A stored field list was the other option and it hid exactly the edit worth
 * catching — a field the user added to a node was not in the list, so it was not in the digest.
 */
function graphState(flowId: EARS.EntityId): GraphState {
  const nodeIds = findRelations({ source: flowId, kind: EARS.RelKind.CONTAINS }).map((r) => r.target as string).sort();
  const relations = [flowId, ...nodeIds]
    .flatMap((source) => findRelations({ source: source as EARS.EntityId }))
    .filter((r) => GRAPH_REL_KINDS.includes(r.kind))
    .map((r) => JSON.stringify([r.source, r.kind, r.target, r.info ?? null]))
    .sort();
  return [contentOf(flowId), nodeIds.map((id) => [id, contentOf(id as EARS.EntityId)]), relations];
}

/**
 * The walk's three parts, a hash each (`AppliedItem.parts`, `@apackdev/sdk/utils`): the flow's own fields, each
 * node's values as one unit, and the whole edge set with each edge's `info`.
 *
 * A node's path is its compiled id, which derives from the flow's name — the determinism `collidingOwner`
 * also rests on. Nothing goes inside a node: edit a step's parameters and what the user is told is that the
 * step changed, which is what someone deciding whether to take a new version needs.
 */
function graphParts([flow, nodes, relations]: GraphState): Record<string, string> {
  return {
    fields: hashValues([flow]),
    ...Object.fromEntries(nodes.map(([id, values]) => [`node:${id}`, hashValues([values])])),
    edges: hashValues([relations]),
  };
}

/**
 * The parts of a recorded flow whose value in the database is no longer what we wrote.
 *
 * Beside `driftedFieldParts` (`format-applier.ts`) rather than one function over both, because a flow's parts and an
 * entity's are produced by different walks; each derivation lives with the writer that produced it. A node
 * the user added or deleted appears as a path on one side only, which the union over both sides is for.
 */
export function driftedGraphParts(item: AppliedItem, flowId: EARS.EntityId): string[] {
  const live = graphParts(graphState(flowId));
  return [...new Set([...Object.keys(item.parts), ...Object.keys(live)])]
    .filter((path) => live[path] !== item.parts[path])
    .sort();
}

/** A DSL entry's content key: the writing pack, then the entry key and the flow's name in the source */
const flowContentKey = (packId: string, name: string) => `${contentKeyPrefix(packId)}${childContentKey('flows', { entity: EARS.Entity.Flow, label: name }, ['label'])}`;

/** A Flow's own short code, `FLW-<n>`: one written before the prefix was declared (`F-<name>`) is not carried */
const FLOW_SHORT_CODE = new RegExp(`^${SDK_SHORT_CODES.Flow}-[1-9][0-9]*$`);

function buildLabelMap(entities: Array<{ label: string; id: EARS.EntityId }>): Map<string, string> {
  return new Map(entities.map((e) => [e.label, e.id]));
}

export interface FlowApplierOptions {
  /** The `flows` entry's `onUserEdit`; see `ContentSourceSchema` */
  onUserEdit?: ContentEditPolicy;
}

export function createFlowApplier(options: FlowApplierOptions = {}): ContentApplier {
  return {
    key: 'flows',
    apply(ctx: ApplyContext): ApplyResult {
      const counts: ApplyResult = { created: 0, updated: 0, skipped: 0 };
      const flowsDSL: any = loadJSON(contentPath(ctx.compiledDir, 'flows'));
      if (!flowsDSL) {
        ctx.log('  compiled flows not found, skipping flows');
        return counts;
      }

      const packId = contentPackId(ctx.compiledDir);

      /**
       * The short codes of flows this apply deleted only to write again — a wipe, or a flow stored under another id
       * than its compiled one — by content key, so the flow it writes in their place keeps the code users know it by.
       * Taken once the delete has happened: a flow the delete refused still holds its code, which a new flow brought
       * would be refused for
       */
      const keptCodes = new Map<string, string>();
      const deleteKeepingCode = (flow: FlowEntity, options?: { allowRoot?: boolean }) => {
        const contentKey = contentKeyOf(flow.id);
        flowRepository.deleteFlow(flow.id, options);
        if (contentKey && typeof flow.shortCode === 'string' && FLOW_SHORT_CODE.test(flow.shortCode)) keptCodes.set(contentKey, flow.shortCode);
      };

      if (ctx.mode === 'wipe-and-replace') {
        for (const flow of sdkEntities.query(EARS.Entity.Flow).pickAll()) {
          try { deleteKeepingCode(flow); } catch {}
        }
        ctx.log('  flows wiped');
      }

      /**
       * The flow written from this DSL entry, however it's been renamed; otherwise a flow without a content key
       * that has its label (a user's flow), so an apply never adds a copy beside it.
       */
      const lookupWritten = (flows: FlowEntity[], name: string): FlowEntity | undefined => {
        const contentKey = flowContentKey(packId, name);
        return flows.find((flow) => contentKeyOf(flow.id) === contentKey)
          ?? flows.find((flow) => flow.label === name && contentKeyOf(flow.id) === undefined);
      };
      const existingFlows = sdkEntities.query(EARS.Entity.Flow).pickAll();
      const actionMap = buildLabelMap(sdkEntities.query(EARS.Entity.Action).pickAll());
      const promptMap = buildLabelMap(promptRepository.all());

      /**
       * Who owns the flow a DSL entry would overwrite: flow and node ids derive from the flow's name, so
       * another pack's flow with that name, or a user's flow with those ids, would be written over. The
       * flow this apply replaces isn't a collision.
       */
      const collidingOwner = (name: string, entry: FlowDSL[string], replacing: FlowEntity | undefined): string | undefined => {
        const ownIds = new Set<string>(replacing
          ? [replacing.id, ...findRelations({ source: replacing.id, kind: EARS.RelKind.CONTAINS }).map((r) => r.target)]
          : []);
        const ids = (compileFlowDSL({ [name]: entry }, { actions: actionMap, prompts: promptMap }).entity as Array<{ id: string }>).map((row) => row.id);
        const taken = ids.find((id) => !ownIds.has(id) && ears().query.withTrashed.ids(id as EARS.EntityId).exists());
        if (!taken) return undefined;
        const flowId = findRelations({ target: taken as EARS.EntityId, kind: EARS.RelKind.CONTAINS })[0]?.source ?? taken;
        const contentKey = contentKeyOf(flowId as EARS.EntityId);
        return contentKey ? `written by ${contentKey.slice(0, contentKey.indexOf(':'))}` : 'created by the user';
      };

      const validFlowDSL: Record<string, any> = {};
      const replacedLabels = new Set<string>();

      /**
       * **Every flow this content declares, before anything is written.** The loop below stops at a flow it
       * means to keep in half a dozen ways — an entry that fails to validate, one the mode skips, one the
       * user owns, one whose ids collide — and a key the loop never reached is still a key the pack ships.
       * Reading "not reached" as "no longer shipped" would have `removals` delete exactly the flow each of
       * those branches exists to protect, an invalid entry most of all: ship one broken flow and the user
       * loses the flow they had.
       */
      for (const name of Object.keys(flowsDSL as Record<string, unknown>)) defineKey(ctx, flowContentKey(packId, name));

      for (const [key, entry] of Object.entries(flowsDSL as Record<string, any>)) {
        if (!selectsAll(ctx.include) && !(ctx.include as ReadonlySet<string>).has(key)) {
          continue;
        }

        const validation = validate({ [key]: entry }, {
          actions: Array.from(actionMap.keys()),
          prompts: Array.from(promptMap.keys()),
          // Validated one at a time, so a subflow naming a sibling would otherwise resolve to nothing
          flowNames: Object.keys(flowsDSL as Record<string, unknown>),
        });
        if (!validation.valid) {
          const msgs = validation.errors.map((e: any) => `${e.path}: ${e.message}`);
          const message = `Flow "${key}" is invalid: ${msgs.join('; ')}`;
          console.error(`[content] ${message}`);
          (counts.errors ??= []).push(message);
          continue;
        }

        const existing = lookupWritten(existingFlows, key);
        const compiledHash = isFlowConfig(entry) ? (entry as any).contentHash : undefined;
        const contentKey = flowContentKey(packId, key);
        const applied = ctx.applied?.before.get(contentKey);
        // A flow is destroyed rather than trashed (`flowRepository.deleteFlow`), so there is no trashed case
        // here: no flow means no flow, and what says whether the user removed it is the record
        const { resolution, parts, offer } = resolve({
          applied,
          ...(compiledHash !== undefined && { incoming: compiledHash as string }),
          ...(existing !== undefined && { live: { contentHash: existing.contentHash } as LiveEntity }),
          ...(ctx.mode !== undefined && { mode: ctx.mode }),
          ...(options.onUserEdit !== undefined && { onUserEdit: options.onUserEdit }),
          ...(ctx.force === true && { force: true }),
          drifted: () => (applied && existing ? driftedGraphParts(applied, existing.id) : []),
        });

        if (resolution !== 'create' && resolution !== 'fast-forward') {
          counts.skipped++;
          if (resolution === 'conflict') {
            if (offer) {
              ctx.applied?.offers.set(contentKey, {
                kind: 'update', parts: parts ?? [],
                ...(typeof compiledHash === 'string' && { contentHash: compiledHash }),
              });
            }
            ctx.log(`  flow skipped (edited: ${(parts ?? []).join(', ')}): ${key}`);
          } else if (resolution === 'absent-by-deletion') {
            ctx.log(`  flow skipped (removed): ${key}`);
          } else if (resolution === 'kept') {
            ctx.log(`  flow skipped (existing): ${key}`);
          } else if (resolution === 'user-owned') {
            ctx.log(`  flow skipped (user-owned): ${key}`);
          } else {
            ctx.log(`  flow unchanged (hash match): ${key}`);
          }
          continue;
        }

        const owner = collidingOwner(key, entry, existing);
        if (owner) {
          const message = `Flow "${key}": a flow with this name already exists (${owner})`;
          console.error(`[content] ${message}`);
          (counts.errors ??= []).push(message);
          continue;
        }

        if (existing) {
          try {
            // The import reconciles a flow already under its compiled id in place, keeping what points into it
            // (runs, subflows, the root role); one under another id can't be reconciled, so it is replaced
            const compiledId = (compileFlowDSL({ [key]: entry }, { actions: actionMap, prompts: promptMap }).entity as Array<{ id: string; entityType?: string }>)
              .find((row) => row.entityType === EARS.Entity.Flow)?.id;
            if (compiledId !== existing.id) deleteKeepingCode(existing, { allowRoot: true });
            replacedLabels.add(key);
            ctx.log(`  flow replaced (hash mismatch): ${key}`);
          } catch (error: any) {
            console.warn(`[content] Failed to replace the content flow "${existing.label}":`, error?.message);
            ctx.log(`  flow skipped: ${key}`);
            counts.skipped++;
            continue;
          }
        }
        validFlowDSL[key] = entry;
      }

      /**
       * The flows a subflow step can name that this apply doesn't (re)import, such as an unchanged flow
       * or a dependency's. A flow this pack's content declares is the flow it wrote, found by content key however
       * it's been renamed, never another flow with its label. When it wrote no flow (the apply left
       * a user's or another pack's flow with that name alone), the name runs that flow; other names
       * resolve by label.
       */
      const subflowTargets = (): Map<string, string> => {
        const flows = sdkEntities.query(EARS.Entity.Flow).pickAll();
        const writtenIds = new Set<string>();
        const targets = new Map<string, string>();
        for (const name of Object.keys(flowsDSL)) {
          const contentKey = flowContentKey(packId, name);
          const written = flows.find((flow) => contentKeyOf(flow.id) === contentKey);
          if (!written) continue;
          targets.set(name, written.id);
          writtenIds.add(written.id);
        }
        for (const flow of flows) {
          if (!writtenIds.has(flow.id) && !targets.has(flow.label)) targets.set(flow.label, flow.id);
        }
        return targets;
      };

      /**
       * The flows this apply wrote that the content no longer declares: removed while they are still ours,
       * kept and flagged once the user has edited one. The conditions are the generic writer's
       * (`format-applier.ts`'s `removals`), and for the same reasons: a file that did not load reaches none of
       * this, and an import carries no record.
       */
      const removals = () => {
        const record = ctx.applied;
        if (!record) return;
        const prefix = `${contentKeyPrefix(packId)}flows/`;
        const flowIds = new Map(sdkEntities.query(EARS.Entity.Flow).ids().map((id) => [contentKeyOf(id), id]));
        for (const itemKey of [...record.before.keys()].filter((k) => k.startsWith(prefix) && !record.defined.has(k))) {
          const item = record.before.get(itemKey)!;
          const flowId = flowIds.get(itemKey);
          const flow = flowId === undefined ? undefined : sdkEntities.query.ids(flowId).pickOne();
          const { resolution, parts, offer } = resolveRemoval({
            applied: item,
            ...(flow !== undefined && { live: { contentHash: flow.contentHash } as LiveEntity }),
            ...(options.onUserEdit !== undefined && { onUserEdit: options.onUserEdit }),
            drifted: () => (flow ? driftedGraphParts(item, flow.id) : []),
          });
          if (resolution === 'removed-but-edited') {
            if (offer) record.offers.set(itemKey, { kind: 'removed', parts: parts ?? [] });
            ctx.log(`  flow kept (dropped from the content, and edited): ${itemKey}`);
            continue;
          }
          try {
            if (flow) flowRepository.deleteFlow(flow.id, { allowRoot: true });
            record.removed.add(itemKey);
            ctx.log(`  flow removed (dropped from the content): ${itemKey}`);
          } catch (err) {
            (counts.errors ??= []).push(`Flow "${itemKey}": ${(err as Error)?.message ?? String(err)}`);
          }
        }
      };

      const flowNames = Object.keys(validFlowDSL);
      if (flowNames.length === 0) {
        ctx.log('  no flows to import');
        removals();
        return counts;
      }

      const compiled = compileFlowDSL(validFlowDSL, { actions: actionMap, prompts: promptMap, flows: subflowTargets() });
      // A flow written in place of one this apply deleted brings that flow's code, as an import does; any other is
      // numbered when it is created, and one already there keeps its own
      for (const row of compiled.entity as Array<{ entityType?: string; label?: string; shortCode?: string }>) {
        const kept = row.entityType === EARS.Entity.Flow && row.label !== undefined ? keptCodes.get(flowContentKey(packId, row.label)) : undefined;
        if (kept) row.shortCode = kept;
      }
      flowRepository.importFromDSL(compiled);
      for (const name of flowNames) {
        const row = (compiled.entity as Array<{ id: string; entityType?: string; label?: string }>)
          .find((entity) => entity.entityType === EARS.Entity.Flow && entity.label === name);
        if (row) {
          const flowId = row.id as EARS.EntityId;
          const contentKey = flowContentKey(packId, name);
          untypedWrite(flowId).set(CONTENT_KEY, contentKey);
          // Read back off the entities a moment after writing them, which is what makes this and
          // `driftedGraphParts` two reads of one question rather than two accounts of it
          const parts = graphParts(graphState(flowId));
          const contentHash = ears().getAttr(flowId, CONTENT_HASH);
          recordApplied(ctx, contentKey, {
            entityType: EARS.Entity.Flow,
            ...(typeof contentHash === 'string' && { contentHash }),
            parts,
          });
        }
        if (replacedLabels.has(name)) {
          counts.updated++;
          ctx.log(`  flow updated: ${name}`);
        } else {
          counts.created++;
          ctx.log(`  flow created: ${name}`);
        }
      }
      removals();
      return counts;
    },
  };
}
