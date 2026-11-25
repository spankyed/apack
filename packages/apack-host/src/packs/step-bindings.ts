import { captureData } from './captured-data.ts';
import { _settingsJsonProblems, type DeclarationData, type StepEntry } from '@apackdev/sdk/framework';
import type { StepDefinition } from '@apackdev/sdk/steps';
import { isPlainObject } from '@apackdev/sdk/utils/pure';

/** Copy declaration data while leaving executable component and function objects intact. */
export function captureStepBinding(step: StepDefinition): StepDefinition {
  if (!isPlainObject(step)) return step;
  const captured = { ...step };
  if (isPlainObject(captured.node)) captured.node = immutableData(captured.node, `Step "${captured.type}": node`);
  if (isPlainObject(captured.build)) captured.build = Object.freeze({ ...captured.build,
    ...(captured.build.relation && { relation: immutableData(captured.build.relation, `Step "${captured.type}": relation`) }),
  });
  if (isPlainObject(captured.trigger)) captured.trigger = Object.freeze({ ...captured.trigger,
    ...(captured.trigger.queryFields && { queryFields: immutableData(captured.trigger.queryFields, `Step "${captured.type}": queryFields`) }),
  });
  if (isPlainObject(captured.runtime)) captured.runtime = Object.freeze({ ...captured.runtime });
  if (isPlainObject(captured.fe)) {
    const fe = { ...captured.fe };
    if (isPlainObject(fe.nodeConfig)) {
      const config = { ...fe.nodeConfig };
      if (isPlainObject(config.connectionRules)) config.connectionRules = immutableData(config.connectionRules, `Step "${captured.type}": connectionRules`);
      fe.nodeConfig = Object.freeze(config);
    }
    if (isPlainObject(fe.components)) fe.components = Object.freeze({ ...fe.components });
    if (isPlainObject(fe.layout)) fe.layout = Object.freeze({ ...fe.layout });
    captured.fe = Object.freeze(fe);
  }
  return Object.freeze(captured);
}

function immutableData<T>(data: T, label: string): T {
  if (_settingsJsonProblems(data).length) throw new Error(`${label} must contain finite, acyclic JSON data properties`);
  return captureData(data);
}

/** Own the exact accepted data before caller-owned origins or catalogs can change. */
export function captureStepDeclaration(declaration: DeclarationData<StepEntry>): DeclarationData<StepEntry> {
  return immutableData(declaration, 'Step declaration');
}
