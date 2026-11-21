import * as path from 'node:path';
import type { PackFlowHelpers } from '@apackdev/sdk/build';
import { bundlePackFlowHelpersModule } from './be-bundler';
import type { RecordReads } from './build-reads';
import type { RecordBuildOutput } from './build-outputs.ts';
import { bundleDeclarations } from './types-bundler';
import { facadeProblems } from './facade-gate';
import type { CompilationInputs } from './compilation-inputs.ts';

/** The declarations of a pack's flow helpers in its types dir */
const FLOW_HELPERS_TYPES_FILE = 'flow-helpers.d.ts';

/**
 * Bundles a pack's generated flow helpers (src/__generated__/flow-helpers.ts) for its snapshot: the
 * ES module, the names it exports and its declarations (written to `typesDir`). Dependents re-export
 * them, so they get the helpers and option types this pack generated. The declarations must be usable
 * by dependents, as the facade types must.
 */
export interface BundleFlowHelpersOptions {
  compilation?: CompilationInputs;
  /** Minify for release bundles, as every pack bundle does */
  release?: boolean;
  /** One recorder per bundle, and this runs two: the ES module, and its declarations */
  recordModuleReads?: RecordReads;
  recordTypeReads?: RecordReads;
  recordOutput?: RecordBuildOutput;
}

export async function bundlePackFlowHelpers(
  packDir: string,
  typesDir: string,
  options: BundleFlowHelpersOptions = {},
): Promise<{ success: true; flowHelpers: PackFlowHelpers } | { success: false; error: string }> {
  const bundled = await bundlePackFlowHelpersModule(packDir, { release: options.release, compilation: options.compilation, recordReads: options.recordModuleReads });
  if (!bundled.success) return bundled;

  const typesFile = path.join(typesDir, FLOW_HELPERS_TYPES_FILE);
  const types = await bundleDeclarations(packDir, path.join(packDir, 'src', '__generated__', 'flow-helpers.ts'), typesFile, { forDependents: true, recordReads: options.recordTypeReads, compilation: options.compilation, recordOutput: options.recordOutput });
  if (!types.success) return types;
  const problems = facadeProblems(packDir, typesFile);
  if (problems.length > 0) {
    return { success: false, error: `the flow helpers' types aren't usable by packs that depend on this one:\n${problems.map((p) => `  - ${p}`).join('\n')}` };
  }

  return { success: true, flowHelpers: { exports: bundled.exports, module: bundled.module, types: types.content } };
}
