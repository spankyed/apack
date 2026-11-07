import { writeManifest } from '../../manifest-writer.ts';
import * as path from 'node:path';
import { regenerateAfterScaffold } from '../generate-entries';
import { validateName, toPascalCase, toCamelCase, toLabel, writeIfNotExists, logCreated, hasFlag } from './write';
import { readManifest, addStep as addStepToManifest } from './manifest';
import { renderTemplate } from '../../templates.ts';



const HELP = `
Usage: apack pack add step <type> [options]

Options:
  --trigger    Create a trigger-type step instead of a regular step

Example:
  apack pack add step my-step
  apack pack add step my-trigger --trigger
`.trim();





// The flows editor renders a step's form with `node` and `resources` ({ actions, flows, models, prompts })
// and listens for `update-node` (the changed fields) and `close`

export async function addStep(args: string[], root: string) {
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(HELP);
    return;
  }

  const type = args[0];
  validateName(type, 'Step');

  const isTrigger = hasFlag(args, '--trigger');
  const camel = toCamelCase(type);
  const pascal = toPascalCase(type);
  const stepDir = path.join(root, 'src', 'extensions', 'steps', type);

  const created: string[] = [];
  // Each branch names its templates literally, which is how `scaffold-templates.spec.ts` sees that a
  // template under `templates/` has a caller at all — a computed path is invisible to it. The two differ in
  // what they take, too: `renderTemplate` refuses a variable the template has no placeholder for.
  const files: [string, string][] = isTrigger
    ? [
      [path.join(stepDir, 'trigger.ts'), renderTemplate('pack/src/extensions/steps/step/trigger.ts', { TYPE: type, CAMEL: camel, LABEL: toLabel(type) })],
      [path.join(stepDir, 'types.ts'), renderTemplate('pack/src/extensions/steps/step/types.ts', { PASCAL: pascal, TYPE: type })],
      [path.join(stepDir, 'form.vue'), renderTemplate('pack/src/extensions/steps/step/form.vue', { PASCAL: pascal })],
    ]
    : [
      [path.join(stepDir, 'build.ts'), renderTemplate('pack/src/extensions/steps/step/build.ts', { TYPE: type, PASCAL: pascal, LABEL: toLabel(type) })],
      [path.join(stepDir, 'types.ts'), renderTemplate('pack/src/extensions/steps/step/types.ts', { PASCAL: pascal, TYPE: type })],
      [path.join(stepDir, 'form.vue'), renderTemplate('pack/src/extensions/steps/step/form.vue', { PASCAL: pascal })],
    ];

  const dir = `src/extensions/steps/${type}`;
  const manifest = readManifest(root);
  addStepToManifest(manifest, type, {
    kind: isTrigger ? 'trigger' : 'step',
    node: {
      label: toLabel(type),
      defaultLabel: isTrigger ? `On ${type}` : toLabel(type),
      ...(isTrigger && { defaults: { source: 'change me' } }),
    },
    ...(isTrigger
      ? { trigger: { trackField: camel, persistent: false, compile: `${dir}/trigger.ts#compile`,
        decompile: `${dir}/trigger.ts#decompile`, validate: `${dir}/trigger.ts#validate` } }
      : { build: { compile: `${dir}/build.ts#compile`, validate: `${dir}/build.ts#validate`,
        getLabel: `${dir}/build.ts#getLabel` } }),
    types: `${dir}/types.ts`,
    fe: {
      colorKey: isTrigger ? 'blue' : 'indigo',
      nodeConfig: {
        icon: isTrigger ? 'Radio' : 'Box',
        connectionRules: { inputs: isTrigger ? 0 : -1, outputs: -1 },
        category: isTrigger ? 'trigger' : 'logic',
        isImplemented: true,
      },
      components: { form: `${dir}/form.vue` },
    },
  });
  writeManifest(root, manifest);

  for (const [filePath, content] of files) {
    if (writeIfNotExists(filePath, content)) created.push(filePath);
  }

  const regenerated = await regenerateAfterScaffold(root);

  console.log(`\nCreated step "${type}":`);
  logCreated(root, created);
  console.log(`  ~ apack.json (steps.${type})`);
  if (regenerated) console.log(`\n  __generated__/ regenerated`);
}
