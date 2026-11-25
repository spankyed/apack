// Active backend implementations. Declaration reads and frontend bindings have separate APIs.
import type { StepDefinition, StepBuildFacet, StepRuntimeFacet, StepNodeFacet, TriggerFacet } from './types.ts';
import { _boundBackendHost } from '../runtime/backend-port.ts';
import { getStepDeclaration } from './catalog.ts';

const step = (type: string): StepDefinition | undefined => _boundBackendHost().packs.step(type);

/** The registered step definitions and their facets, by type */
interface StepRegistry {
  get(type: string): StepDefinition | undefined;
  getBuild(type: string): StepBuildFacet | undefined;
  getRuntime(type: string): StepRuntimeFacet | undefined;
  getNode(type: string): StepNodeFacet | undefined;
  has(type: string): boolean;
  isTrigger(type: string): boolean;
  getTrigger(type: string): TriggerFacet | undefined;
  triggers(): StepDefinition[];
  types(): string[];
  all(): StepDefinition[];
  createNodeDefaults(nodeType: string): Record<string, unknown>;
}

export const stepRegistry: StepRegistry = {
  get(type: string): StepDefinition | undefined {
    return step(type);
  },

  getBuild(type: string): StepBuildFacet | undefined {
    return step(type)?.build;
  },

  getRuntime(type: string): StepRuntimeFacet | undefined {
    return step(type)?.runtime;
  },

  getNode(type: string): StepNodeFacet | undefined {
    return getStepDeclaration(type)?.declaration.node;
  },

  has(type: string): boolean {
    return step(type) !== undefined;
  },

  isTrigger(type: string): boolean {
    return step(type)?.kind === 'trigger';
  },

  getTrigger(type: string): TriggerFacet | undefined {
    return step(type)?.trigger;
  },

  triggers(): StepDefinition[] {
    return _boundBackendHost().packs.steps().filter(s => s.kind === 'trigger');
  },

  types(): string[] {
    return _boundBackendHost().packs.steps().map(s => s.type);
  },

  all(): StepDefinition[] {
    return _boundBackendHost().packs.steps();
  },

  /** Initial JSON fields from declarations, available even without an active provider. */
  createNodeDefaults(nodeType: string): Record<string, unknown> {
    const node = getStepDeclaration(nodeType)?.declaration.node;
    if (!node) return { nodeType };
    return { nodeType, label: node.label, ...structuredClone(node.defaults) };
  },
};
