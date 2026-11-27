import { writeManifest } from '../../manifest-writer.ts';
import { FEATURE_ID_PATTERN, FeatureEntrySchema } from '@apackdev/pack-format';
import * as fs from 'node:fs';
import { renderTemplate } from '../../templates.ts';
import * as path from 'node:path';
import { regenerateAfterScaffold } from '../generate-entries';
import { scaffoldUnitTestSetup, type UnitTestSetup } from '../init';
import { toPascalCase, toCamelCase, toLabel, writeIfNotExists, logCreated, parseFlag, hasFlag } from './write';
import { readManifest, addFeature as addFeatureToManifest } from './manifest';

/**
 * The strings a feature's templates are rendered with, derived once. Five of them wrote
 * `name.toUpperCase().replace(/-/g, '_')` inline and two called `toPascalCase`/`toCamelCase` inside the literal;
 * the event names are whole placeholders rather than a stem glued to `REFRESH_`, so a template reads as the code
 * it emits.
 */
function featureValues(name: string) {
  const event = name.toUpperCase().replace(/-/g, '_');
  return {
    NAME: name,
    CAMEL: toCamelCase(name),
    PASCAL: toPascalCase(name),
    CONNECTED_EVENT: `${event}_CONNECTED`,
    REFRESH_EVENT: `REFRESH_${event}`,
  };
}

const HELP = `
Usage: apack pack add feature <name> --description <purpose> [options]

Options:
  --description <purpose> Required feature purpose
  --label <Label>          Display label (default: derived from name)
  --icon <LucideIcon>      Lucide icon name (default: Box)
  --designation <role>     The role this feature plays, for getDesignated(role); need not be the feature name

Example:
  apack pack add feature bookmarks --description "Save and organize bookmarks." --label "Bookmarks" --icon Bookmark
`.trim();

export async function addFeature(args: string[], root: string) {
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(HELP);
    return;
  }

  const name = args[0];
  if (!name) throw new Error('Feature name is required');
  if (!FEATURE_ID_PATTERN.test(name)) {
    throw new Error(`Feature name "${name}" must start with a lowercase letter and contain only letters and digits (e.g. "notes" or "calendarEvents"); it is used as an identifier in generated code`);
  }

  const description = parseFlag(args, '--description');
  const purpose = FeatureEntrySchema.shape.description.safeParse(description);
  if (!purpose.success || description?.startsWith('--')) {
    throw new Error('--description <purpose> is required and must not be blank');
  }

  const label = parseFlag(args, '--label') || toLabel(name);
  const icon = parseFlag(args, '--icon') || 'Box';
  const designation = parseFlag(args, '--designation');
  const camel = toCamelCase(name);
  const pascal = toPascalCase(name);
  const v = featureValues(name);
  const featureRoot = `src/features/${name}`;
  const layout = {
    system: `${featureRoot}/be/system.ts`, types: `${featureRoot}/be/types.ts`,
    systemContract: `${featureRoot}/be/contract.ts`, repositories: `${featureRoot}/be/repository/index.ts`,
    surfaceContract: `${featureRoot}/fe/contract.ts`, state: `${featureRoot}/fe/state.ts`,
    canvas: `${featureRoot}/fe/canvas/list.vue`, settingsForm: `${featureRoot}/fe/settings.vue`,
  };

  const created: string[] = [];
  // The system test runs on the harness: a pack scaffolded before it has no tests/setup.ts
  const unitTestSetup = fs.existsSync(path.join(root, 'tests', 'setup.ts')) ? undefined : scaffoldUnitTestSetup(root);
  const files: [string, string][] = [
    [path.join(root, layout.system), renderTemplate('pack/src/features/feature/be/system.ts', { NAME: v.NAME, CAMEL: v.CAMEL, PASCAL: v.PASCAL, CONNECTED_EVENT: v.CONNECTED_EVENT, REFRESH_EVENT: v.REFRESH_EVENT })],
    [path.join(root, layout.types), renderTemplate('pack/src/features/feature/be/types.ts', { PASCAL: v.PASCAL, CONNECTED_EVENT: v.CONNECTED_EVENT, REFRESH_EVENT: v.REFRESH_EVENT })],
    [path.join(root, layout.systemContract), renderTemplate('pack/src/features/feature/be/contract.ts', { PASCAL: pascal })],
    [path.join(root, layout.repositories), renderTemplate('pack/src/features/feature/be/repository/index.ts', { CAMEL: camel })],
    [path.join(root, layout.surfaceContract), renderTemplate('pack/src/features/feature/fe/contract.ts', { PASCAL: pascal })],
    [path.join(root, layout.state), renderTemplate('pack/src/features/feature/fe/state.ts', { NAME: v.NAME, CAMEL: v.CAMEL, PASCAL: v.PASCAL })],
    [path.join(root, layout.canvas), renderTemplate('pack/src/features/feature/fe/canvas/list.vue', { LABEL: label })],
    [path.join(root, layout.settingsForm), renderTemplate('pack/src/features/feature/fe/settings.vue')],
    [path.join(root, 'tests', 'features', name, 'be', 'system.spec.ts'), renderTemplate('pack/tests/features/feature/be/system.spec.ts', { NAME: v.NAME, CONNECTED_EVENT: v.CONNECTED_EVENT })],
  ];

  for (const [filePath, content] of files) {
    if (writeIfNotExists(filePath, content)) created.push(filePath);
  }

  const manifest = readManifest(root);
  addFeatureToManifest(manifest, name, {
    description: purpose.data,
    ...(designation !== undefined && { designation }),
    settings: { schema: { type: 'object', additionalProperties: false }, defaults: {}, form: layout.settingsForm },
    system: { entry: layout.system, contract: `${layout.systemContract}#Contract` },
    surface: { label, icon, state: layout.state, canvas: layout.canvas, defaultVisible: true, contract: `${layout.surfaceContract}#Contract` },
    types: layout.types,
    services: {},
    repositories: {
      [`${camel}Queries`]: `${layout.repositories}#${camel}Queries`,
      [`${camel}Commands`]: `${layout.repositories}#${camel}Commands`,
    },
  });
  writeManifest(root, manifest);

  const regenerated = await regenerateAfterScaffold(root);

  console.log(`\nCreated feature "${name}":`);
  logCreated(root, [...(unitTestSetup?.created ?? []), ...created]);
  if (regenerated) console.log(`\n  manifest updated + __generated__/ regenerated`);
  if (unitTestSetup) logUnitTestSetup(unitTestSetup);
}

function logUnitTestSetup({ keptConfig, addedDependencies, upgrades }: UnitTestSetup): void {
  console.log(`\nThe pack had no unit test setup, which the feature's system test runs on: added tests/setup.ts (@apackdev/testing/harness).`);
  if (keptConfig) {
    console.log(`  ${keptConfig} already exists: give its test options isolatedDataDir()'s env and globalSetup, and setupFiles: [...dataDir.setupFiles, './tests/setup.ts'] (@apackdev/testing/vitest)`);
  }
  if (addedDependencies.length > 0) {
    console.log(`  Added ${addedDependencies.join(', ')} to devDependencies. Run: npm install`);
  }
  if (upgrades.length > 0) {
    console.log(`  The harness can't run on the pack's ${upgrades.map(({ name, reason }) => `${name} (${reason})`).join(', ')}.`);
    console.log(`  Upgrade: npm install -D ${upgrades.map(({ name, range }) => `${name}@"${range}"`).join(' ')}`);
  }
}
