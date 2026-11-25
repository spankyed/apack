import type { ContentReference } from '../content-references.ts';
import type { StepDefinition } from '@apackdev/sdk/steps';
import { resolveTracks, type DSLStepNode, type FlowDSL } from '@apackdev/sdk/build';

/** Build-time projection of declared DSL fields; offline readers consume only its serialized results. */
export function flowContentReferences(flows: FlowDSL, steps: readonly StepDefinition[]): ContentReference[] {
  const definitions = new Map(steps.map(step => [step.type, step]));
  const references: ContentReference[] = [];
  const fields = (item: string, node: Record<string, unknown>, definition: StepDefinition | undefined, path: string) => {
    for (const [field, key] of Object.entries(definition?.dsl?.references ?? {})) {
      if (!Object.hasOwn(node, field)) continue;
      const target = node[field];
      references.push(typeof target === 'string'
        ? { item, path: `${path}.${field}`, kind: 'static', target: { key, item: target } }
        : { item, path: `${path}.${field}`, kind: 'dynamic', target: { key } });
    }
  };
  const visit = (item: string, nodes: readonly DSLStepNode[], path: string) => {
    for (const [position, node] of nodes.entries()) {
      const location = `${path}[${position}]`;
      const definition = definitions.get(node.type);
      fields(item, node, definition, location);
      for (const branch of definition?.build?.branches?.(node) ?? []) visit(item, branch.steps as DSLStepNode[], `${location}.${branch.key}`);
    }
  };
  const triggers = steps.filter(step => step.kind === 'trigger' && step.trigger);
  for (const [item, flow] of Object.entries(flows)) {
    for (const [position, track] of resolveTracks(flow).entries()) {
      const path = `${item}[${position}]`;
      for (const trigger of triggers.filter(step => typeof track[step.trigger!.trackField] === 'string')) {
        fields(item, track, trigger, path);
      }
      for (const [exit, nodes] of track.exits.entries()) visit(item, nodes, `${path}.exits[${exit}]`);
    }
  }
  return references;
}
