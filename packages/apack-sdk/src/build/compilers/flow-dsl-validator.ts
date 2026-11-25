import type { ValidationError, ValidationResult } from '../content-types.ts';
import { isFlowConfig, resolveTracks, type FlowConfig, type Track } from './flow-types.ts';
import { stepLookup } from './step-lookup.ts';
import type { StepDefinition, StepBuildFacet, StepValidationContext } from '../../steps/types.ts';

const FALLBACK_STEP_TYPES = [
  'action', 'llm', 'switch', 'fire', 'transform',
  'query', 'subflow', 'create', 'update', 'keep_alive', 'kill',
] as const;

interface ValidationContext {
  actions: Set<string>;
  prompts: Set<string>;
  flowNames: Set<string>;
  nodeLabels: Set<string>;
  path: string;
}

interface ResolvedSteps {
  triggers: StepDefinition[];
  isTrigger(type: string): boolean;
  getBuild(type: string): StepBuildFacet | undefined;
  types(): string[];
}

function resolveSteps(options: ValidateOptions): ResolvedSteps {
  // Without definitions, the registered packs' steps
  const steps = stepLookup(options.steps);
  return {
    triggers: steps.triggers(),
    isTrigger: (type) => steps.isTrigger(type),
    getBuild: (type) => steps.getBuild(type),
    types: () => steps.types(),
  };
}

export interface ValidateOptions {
  actions?: string[];
  prompts?: string[];
  /**
   * The flows a `subflow` may name, when that is more than the bundle being validated. The applier validates one
   * flow at a time, so without this every reference to a sibling flow would be reported as missing.
   */
  flowNames?: string[];
  skipReferenceCheck?: boolean;
  stepTypes?: string[];
  steps?: StepDefinition[];
}

export function validate(dsl: unknown, options: ValidateOptions = {}): ValidationResult {
  const errors: ValidationError[] = [];

  if (!dsl || typeof dsl !== 'object' || Array.isArray(dsl)) {
    return {
      valid: false,
      errors: [{ path: '', message: 'DSL must be an object mapping flow names to track arrays' }],
    };
  }

  const flows = dsl as Record<string, unknown>;
  const flowNames = new Set(Object.keys(flows));

  if (flowNames.size === 0) {
    errors.push({ path: '', message: 'At least one flow must be defined' });
  }

  const ctx: ValidationContext = {
    actions: new Set(options.actions || []),
    prompts: new Set(options.prompts || []),
    // The bundle's own keys answer "is this DSL well formed"; the override answers "does this name resolve",
    // which is a wider question whenever the caller holds more flows than it is validating.
    flowNames: options.flowNames ? new Set(options.flowNames) : flowNames,
    nodeLabels: new Set(),
    path: '',
  };

  const rootFlows: string[] = [];
  for (const [flowName, entry] of Object.entries(flows)) {
    if (isFlowConfig(entry as Track[] | FlowConfig) && (entry as FlowConfig).root) {
      rootFlows.push(flowName);
    }
  }
  if (rootFlows.length > 1) {
    errors.push({ path: '', message: `Multiple flows marked as root: ${rootFlows.join(', ')}. At most one flow can be root.` });
  }

  const resolved = resolveSteps(options);

  for (const [flowName, entry] of Object.entries(flows)) {
    ctx.path = flowName;
    ctx.nodeLabels = new Set();
    const tracks = resolveTracks(entry as Track[] | FlowConfig);
    const flowErrors = validateFlow(flowName, tracks, ctx, options, resolved);
    errors.push(...flowErrors);
  }

  return { valid: errors.length === 0, errors };
}

function validateFlow(
  _flowName: string,
  tracks: unknown,
  ctx: ValidationContext,
  options: ValidateOptions,
  resolved: ResolvedSteps,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!Array.isArray(tracks)) {
    errors.push({ path: ctx.path, message: 'Flow must be an array of tracks' });
    return errors;
  }

  if (tracks.length === 0) {
    errors.push({ path: ctx.path, message: 'Flow must have at least one track' });
    return errors;
  }

  const nodeLabels = new Set<string>();
  for (let trackIdx = 0; trackIdx < tracks.length; trackIdx++) {
    const track = tracks[trackIdx] as Record<string, unknown>;
    if (!track || typeof track !== 'object') continue;

    const trackLabel = getTrackLabel(track, trackIdx, resolved);
    if (nodeLabels.has(trackLabel)) {
      errors.push({ path: `${ctx.path}[${trackIdx}]`, message: `Duplicate label: "${trackLabel}"` });
    }
    nodeLabels.add(trackLabel);

    const exits = track.exits as unknown[];
    if (Array.isArray(exits)) {
      for (let exitIdx = 0; exitIdx < exits.length; exitIdx++) {
        const exitSteps = exits[exitIdx] as unknown[];
        if (Array.isArray(exitSteps)) {
          collectStepLabels(exitSteps, nodeLabels, errors, `${ctx.path}[${trackIdx}].exits[${exitIdx}]`, resolved);
        }
      }
    }
  }
  ctx.nodeLabels = nodeLabels;

  for (let trackIdx = 0; trackIdx < tracks.length; trackIdx++) {
    const trackPath = `${ctx.path}[${trackIdx}]`;
    errors.push(...validateTrack(tracks[trackIdx], trackPath, ctx, options, resolved));
  }

  return errors;
}

function validateTrack(
  track: unknown,
  path: string,
  ctx: ValidationContext,
  options: ValidateOptions,
  resolved: ResolvedSteps,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!track || typeof track !== 'object' || Array.isArray(track)) {
    errors.push({ path, message: 'Track must be an object with "event" and "exits"' });
    return errors;
  }

  const t = track as Record<string, unknown>;

  const triggerDefs = resolved.triggers;
  if (triggerDefs.length === 0) {
    throw new Error(options.steps !== undefined
      ? 'No trigger step among the step definitions given, so no track can be validated. A pack build compiles flows against '
        + "its pack config's step definitions (loadDefinitions) or compilePack's options.definitions: give it the definitions of a pack whose steps include triggers (default-setup's)."
      : 'No trigger types provided. Pass step definitions via options.steps, or register a pack that defines them.');
  }
  const knownTrackFields = triggerDefs.map(d => d.trigger!.trackField);
  const presentFields = knownTrackFields.filter(f => typeof t[f] === 'string' && (t[f] as string).length > 0);

  if (presentFields.length === 0) {
    errors.push({ path, message: `Track must have one of: ${knownTrackFields.map(f => `"${f}"`).join(', ')}` });
  }
  if (presentFields.length > 1) {
    errors.push({ path, message: `Track cannot have multiple trigger fields: ${presentFields.join(', ')}` });
  }

  for (const field of presentFields) {
    const def = triggerDefs.find(d => d.trigger?.trackField === field);
    if (def?.trigger?.validateTrack) {
      const result = def.trigger.validateTrack(t as Record<string, unknown>);
      for (const err of result.errors) {
        errors.push({ path: `${path}.${field}`, message: err });
      }
    }
  }

  if (!Array.isArray(t.exits)) {
    errors.push({ path, message: 'Track must have an "exits" array' });
    return errors;
  } else if (t.exits.length === 0) {
    errors.push({ path: `${path}.exits`, message: 'Exits must have at least one path' });
  } else {
    for (let exitIdx = 0; exitIdx < t.exits.length; exitIdx++) {
      const exitPath = `${path}.exits[${exitIdx}]`;
      const exitSteps = t.exits[exitIdx];
      if (!Array.isArray(exitSteps)) {
        errors.push({ path: exitPath, message: 'Each exit must be a steps array' });
      } else {
        for (let si = 0; si < exitSteps.length; si++) {
          errors.push(...validateStep(exitSteps[si], `${exitPath}[${si}]`, ctx, options, resolved));
        }
      }
    }
  }

  return errors;
}

function getValidStepTypes(options: ValidateOptions, resolved: ResolvedSteps): string[] {
  const types = new Set<string>(FALLBACK_STEP_TYPES);
  for (const t of resolved.types()) types.add(t);
  if (options.stepTypes) {
    for (const t of options.stepTypes) types.add(t);
  }
  return [...types];
}

function validateStep(
  step: unknown,
  path: string,
  ctx: ValidationContext,
  options: ValidateOptions,
  resolved: ResolvedSteps,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    errors.push({ path, message: 'Step must be an object' });
    return errors;
  }

  const s = step as Record<string, unknown>;

  if (!s.type) {
    errors.push({ path, message: 'Step must have a "type" field' });
    return errors;
  }

  if (resolved.isTrigger(s.type as string)) {
    errors.push({ path, message: `Steps cannot have type "${s.type}". Trigger types belong at the track level.` });
    return errors;
  }

  const validTypes = getValidStepTypes(options, resolved);
  if (!validTypes.includes(s.type as string)) {
    errors.push({ path, message: `Invalid step type: "${s.type}". Must be one of: ${validTypes.join(', ')}` });
    return errors;
  }

  if (s.next && typeof s.next === 'string') {
    if (!ctx.nodeLabels.has(s.next)) {
      errors.push({ path: `${path}.next`, message: `Referenced node "${s.next}" not found in this flow` });
    }
  }

  const stepType = s.type as string;
  const buildFacet = resolved.getBuild(stepType);

  if (buildFacet) {
    const stepCtx: StepValidationContext = {
      actions: ctx.actions,
      prompts: ctx.prompts,
      flowNames: ctx.flowNames,
      nodeLabels: ctx.nodeLabels,
      path,
      skipReferenceCheck: options.skipReferenceCheck,
    };
    errors.push(...buildFacet.validate(s, path, stepCtx));
  }

  const branchList = buildFacet?.branches?.(s);
  if (branchList?.length) {
    for (const branch of branchList) {
      for (let si = 0; si < branch.steps.length; si++) {
        errors.push(...validateStep(branch.steps[si], `${path}.${branch.key}[${si}]`, ctx, options, resolved));
      }
    }
  }

  return errors;
}

function collectStepLabels(
  steps: unknown[],
  nodeLabels: Set<string>,
  errors: ValidationError[],
  basePath: string,
  resolved: ResolvedSteps,
): void {
  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const step = steps[stepIdx] as Record<string, unknown>;
    if (!step || typeof step !== 'object') continue;

    const stepLabel = getStepLabel(step, stepIdx, resolved);
    if (nodeLabels.has(stepLabel)) {
      errors.push({ path: `${basePath}[${stepIdx}]`, message: `Duplicate label: "${stepLabel}"` });
    }
    nodeLabels.add(stepLabel);

    const buildFacet = resolved.getBuild(step.type as string);
    const branchList = buildFacet?.branches?.(step);
    if (branchList?.length) {
      for (const branch of branchList) {
        collectStepLabels(branch.steps as unknown[], nodeLabels, errors, `${basePath}[${stepIdx}].${branch.key}`, resolved);
      }
    }
  }
}

function getTrackLabel(track: Record<string, unknown>, index: number, resolved: ResolvedSteps): string {
  if (typeof track.label === 'string') return track.label;
  if (typeof track.event === 'string') return track.event;
  for (const def of resolved.triggers) {
    const field = def.trigger?.trackField;
    if (field && typeof track[field] === 'string') {
      const prefix = def.node?.label || def.type || 'Trigger';
      return `${prefix} ${index}`;
    }
  }
  return `Track ${index}`;
}

function getStepLabel(step: Record<string, unknown>, index: number, resolved: ResolvedSteps): string {
  const buildFacet = resolved.getBuild(step.type as string);
  if (buildFacet) {
    return buildFacet.getLabel(step, index);
  }

  if (typeof step.label === 'string') return step.label;
  switch (step.type) {
    case 'action': return step.action as string || `Action ${index}`;
    case 'llm': return step.prompt as string || `LLM ${index}`;
    case 'fire': return step.event as string || `Fire ${index}`;
    case 'subflow': return step.flow as string || `Flow ${index}`;
    case 'switch': return `Switch ${index}`;
    case 'transform': return `Transform ${index}`;
    case 'query': return `Query ${index}`;
    case 'create': return `Create ${step.entity || index}`;
    case 'update': return `Update ${index}`;
    case 'keep_alive': return `Keep Alive ${index}`;
    case 'kill': return `Kill Flow ${index}`;
    default: return `Step ${index}`;
  }
}
