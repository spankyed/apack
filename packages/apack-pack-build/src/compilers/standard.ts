import { flowContentReferences } from './flow-references.ts';
import { compileSourceDir } from '../compile-utils.ts';
import type { SpecialtyCompiler, CompilationContext } from '../content-compiler.ts';
import type { CompiledEntry, CompileResult } from '../compile-utils.ts';
import { loadFlowsFromDir, validateFlows, hashFlows } from './compile-flows.ts';
import type { FlowDSL, ValidationResult } from '@apackdev/sdk/build';
import { documentsCompiler, commandsCompiler } from './documents.ts';

/** Entries from a source directory of DSL functions, with duplicate labels rejected */
function uniqueEntries(kind: string, compiled: CompileResult): CompiledEntry[] {
  const seen = new Set<string>();
  for (const entry of compiled.entries) {
    if (seen.has(entry.label)) throw new Error(`Duplicate ${kind} label "${entry.label}"`);
    seen.add(entry.label);
  }
  for (const warning of compiled.warnings) console.warn(`  ! ${warning}`);
  return compiled.entries;
}

/** A compiled action or prompt, tagged with the entity type it writes */
export type CompiledContentEntry = CompiledEntry & { entity: string };

interface DslCompiled {
  records: CompiledContentEntry[];
  errors: string[];
}

const labelledItems = (data: DslCompiled) => data.records.map((record) => ({
  key: record.label,
  ...(record.description && { description: record.description }),
}));

export const actionsCompiler: SpecialtyCompiler<DslCompiled> = {
  identity: ['label'],
  async compile(dir) {
    const compiled = await compileSourceDir(dir, {
      functionName: 'action',
      isAsync: true,
      fields: { metaInput: 'input', fnBody: 'actionFn', output: 'output' },
    });
    return { records: uniqueEntries('action', compiled).map((entry) => ({ entity: 'Action', ...entry })), errors: compiled.errors };
  },
  collectErrors: (data) => data.errors,
  output: (data) => ({ records: data.records }),
  count: (data) => data.records.length,
  items: labelledItems,
};

export const promptsCompiler: SpecialtyCompiler<DslCompiled> = {
  identity: ['label'],
  async compile(dir) {
    const compiled = await compileSourceDir(dir, {
      functionName: 'template',
      isAsync: false,
      fields: { metaInput: 'inputs', fnBody: 'templateFn', output: 'outputSchema' },
    });
    return { records: uniqueEntries('prompt', compiled).map((entry) => ({ entity: 'Prompt', ...entry })), errors: compiled.errors };
  },
  collectErrors: (data) => data.errors,
  output: (data) => ({ records: data.records }),
  count: (data) => data.records.length,
  items: labelledItems,
};

export const flowsCompiler: SpecialtyCompiler<FlowDSL> = {
  references: (flows, context) => flowContentReferences(flows, context.steps),
  async compile(dir, { importModule }) {
    return (await loadFlowsFromDir(dir, importModule)).merged;
  },

  validate(flows: FlowDSL, context: CompilationContext): ValidationResult {
    if (Object.keys(flows).length === 0) return { valid: true, errors: [] };
    const actions = context.getCompiled<DslCompiled>('actions')?.records ?? [];
    const prompts = context.getCompiled<DslCompiled>('prompts')?.records ?? [];
    return validateFlows(
      flows,
      actions.map((action) => action.label),
      prompts.map((prompt) => prompt.label),
      { steps: context.steps },
    );
  },

  output: (flows) => (Object.keys(flows).length > 0 ? hashFlows(flows) : {}),
  count: (flows) => Object.keys(flows).length,
  items: (flows) => Object.entries(flows).map(([name, flow]) => {
    const description: unknown = Array.isArray(flow) ? undefined : (flow as { description?: unknown }).description;
    return { key: name, ...(typeof description === 'string' && { description }) };
  }),
};

/** Content keys the SDK compiles itself */
export const SPECIALTY_COMPILERS: Record<string, SpecialtyCompiler> = {
  actions: actionsCompiler as SpecialtyCompiler,
  prompts: promptsCompiler as SpecialtyCompiler,
  flows: flowsCompiler as SpecialtyCompiler,
  documents: documentsCompiler as SpecialtyCompiler,
  commands: commandsCompiler as SpecialtyCompiler,
};
