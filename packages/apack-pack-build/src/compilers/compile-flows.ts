import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { importPackModule } from '../module-loader.ts';
import type { PackModuleLoader } from '../types.ts';
import { isFlowConfig, validateFlowDSL as validate, type FlowConfig, type FlowDSL, type ValidationResult } from '@apackdev/sdk/build';

export async function loadFlowsFromDir(flowsDir: string, importModule: PackModuleLoader = importPackModule): Promise<{
  merged: FlowDSL;
  rootFlowName: string | null;
  loaded: number;
}> {
  if (!fs.existsSync(flowsDir)) {
    return { merged: {}, rootFlowName: null, loaded: 0 };
  }

  const tsFiles = fs.readdirSync(flowsDir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.example.ts') && !f.startsWith('_'))
    .sort();

  const merged: FlowDSL = {};
  let loaded = 0;
  let rootFlowName: string | null = null;

  for (const file of tsFiles) {
    const filePath = path.join(flowsDir, file);
    const mod = await importModule(filePath);

    if (!mod.default) continue;

    const flowDSL = mod.default as FlowDSL;
    for (const flowName of Object.keys(flowDSL)) {
      if (merged[flowName]) {
        throw new Error(`Duplicate flow name "${flowName}" in ${file}`);
      }

      const entry = flowDSL[flowName];
      if (isFlowConfig(entry) && entry.root) {
        if (rootFlowName) {
          throw new Error(`Multiple root flows: "${rootFlowName}" and "${flowName}" (in ${file})`);
        }
        rootFlowName = flowName;
      }

      merged[flowName] = entry;
    }
    loaded++;
  }

  return { merged, rootFlowName, loaded };
}

export function validateFlows(
  merged: FlowDSL,
  actionLabels: string[],
  promptLabels: string[],
  options?: { steps?: import('@apackdev/sdk/steps').StepDefinition[] },
): ValidationResult {
  return validate(merged, { actions: actionLabels, prompts: promptLabels, steps: options?.steps });
}

export function hashFlows(merged: FlowDSL): Record<string, object> {
  const hashed: Record<string, object> = {};
  for (const [name, entry] of Object.entries(merged)) {
    const config = isFlowConfig(entry) ? entry : { tracks: entry };
    const contentHash = crypto.createHash('sha256')
      .update(JSON.stringify({ tracks: config.tracks, root: (config as FlowConfig).root }))
      .digest('hex')
      .slice(0, 16);
    hashed[name] = { ...config, contentHash };
  }
  return hashed;
}
