import { writeManifest } from '../../manifest-writer.ts';
import * as path from 'node:path';
import { renderTemplate } from '../../templates.ts';
import { regenerateAfterScaffold } from '../generate-entries';
import { writeIfNotExists, logCreated, parseFlag, hasFlag } from './write';
import { MIGRATION_TARGET_PATTERN, type MigrationLine } from '@apackdev/pack-format';
import { readManifest, addMigration as addMigrationToManifest } from './manifest';

const HELP = `
Usage: apack pack add migration [version] [options]

Options:
  --version <version>    Target version (default: this pack's version)
  --app                  Target apack's version line instead of this pack's

A migration's version line says what its target is a version of. By default that is this pack's own
\`version\`, which is what moves when the pack does. --app puts it on apack's release line, for data
whose shape follows the app rather than the pack. Either way a target is a release — three numbers — and a
prerelease is normalised to the release it belongs to.

Example:
  apack pack add migration 0.2.0
  apack pack add migration --version 0.2.0
  apack pack add migration 0.4.1 --app
`.trim();

export async function addMigration(args: string[], root: string) {
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(HELP);
    return;
  }

  const manifest = readManifest(root);
  // The pack's own line is the default, since a pack's data usually moves when the pack does — and because
  // the app's line is a third party putting code on apack's versions, which should be asked for
  const line: MigrationLine = hasFlag(args, '--app') ? 'app' : 'pack';
  // The positional is the first argument that is not a flag, so `add migration --app` falls through to the
  // manifest's version. Reading `args[0]` instead takes `--app` as the version it targets, and the
  // normalisation below strips from the first `-`: the manifest gains a key of `""` naming a file called
  // `.ts`, and the only thing that objects is the next command to read the manifest
  const positional = args.find((arg) => !arg.startsWith('-'));
  const asked = parseFlag(args, '--version') || positional || manifest.version || '0.0.0';
  // A migration targets a *release*, on either line: the manifest key is three numbers and nothing else, and
  // the app's runner reads a prerelease as its release (`0.4.0-beta.2` runs the `0.4.0` migrations), so a
  // prerelease target is one nothing would ever match. The default is the manifest's version, which during
  // a beta is a prerelease, so it is normalised rather than refused
  const version = asked.replace(/[-+].*$/, '');
  // Checked before anything is written. The manifest's schema holds the same rule and is the backstop, but
  // it speaks on the next read of the manifest — too late to stop this command writing the entry and an
  // empty module and reporting that it worked
  if (!MIGRATION_TARGET_PATTERN.test(version)) {
    const example = manifest.version?.replace(/[-+].*$/, '') || '0.1.0';
    throw new Error(`"${asked}" is not a version a migration can target: give it as "major.minor.patch" (e.g. ${example})`);
  }
  if (version !== asked) console.log(`  ${asked} targets its release, ${version}`);
  const filePath = path.join(root, 'src', 'migrations', `${version}.ts`);

  // The manifest entry first: it is the declaration, its key is the version the migration targets and the
  // map it goes in is the line that version is on, so a file no manifest names runs never. It refuses a
  // version already declared on that line rather than writing twice
  addMigrationToManifest(manifest, line, version, { description: 'Describe what this migration changes', up: `src/migrations/${version}.ts#up` });
  writeManifest(root, manifest);

  const created: string[] = [];
  if (writeIfNotExists(filePath, renderTemplate('pack/src/migrations/migration.ts', {}))) {
    created.push(filePath);
  }

  const regenerated = await regenerateAfterScaffold(root);

  const lineSays = line === 'app' ? "apack's version" : "this pack's version";
  console.log(`\nCreated migration targeting ${lineSays} "${version}":`);
  logCreated(root, created);
  console.log(`  ~ apack.json (migrations.${line}.${version})`);
  if (regenerated) console.log(`\n  __generated__/ regenerated`);
}
