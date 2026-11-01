import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPackBuild } from '@apackdev/host/packs';
import { sha256File } from '@apackdev/host/packs/assets';
import { readPackBuildInputs, assertPackBuildInputsCurrent } from '@apackdev/host/build/pack-build-inputs';
import { boundedSpawn } from '../../scripts/lib/bounded-spawn.ts';
import { timeoutMsFor } from '../../scripts/lib/step-timeouts.ts';

const root = fs.realpathSync.native(fileURLToPath(new URL('../../', import.meta.url)));
const source = path.join(root, 'packages/default-setup');
const output = path.join(root, 'node_modules/.cache/apack-fixtures/default-fork');
const remedy = 'Run npm run test:external-pack:fork to prepare the default fork.';

// Shares of the bound on `test:external-pack:fork`, the step that runs this, so the phases fit inside it by
// construction. Each is a ceiling for a phase that spins: one that stops working is ended sooner, as stalled.
const FORK_STEP_MS = timeoutMsFor('scenario');
export const DEFAULT_FORK_BUDGET_MS = {
  build: 0.5 * FORK_STEP_MS,
  // Two input replays plus archive staging/verification.
  archive: 0.3 * FORK_STEP_MS,
  // Package freshness, source copying, final verification and removal of owned temporary trees.
  housekeeping: 0.2 * FORK_STEP_MS,
} as const;

function shippedRevision(): string {
  const dist = path.join(source, 'dist');
  const build = readPackBuild(dist);
  assertPackBuildInputsCurrent(source, readPackBuildInputs(dist, build.integrity));
  return build.revision;
}

export function verifyDefaultPackFork(): void {
  const file = path.join(output, 'fork.json');
  if (!fs.existsSync(file)) throw new Error(remedy);
  const prepared = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof prepared.archive !== 'string' || !prepared.archive.endsWith('.tgz') || path.basename(prepared.archive) !== prepared.archive
    || typeof prepared.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(prepared.archiveSha256)
    || prepared.shippedBuildRevision !== shippedRevision()
    || !fs.existsSync(path.join(output, prepared.archive)) || !fs.existsSync(path.join(output, `${prepared.archive}.sha256`))
    || sha256File(path.join(output, prepared.archive)) !== prepared.archiveSha256
    || fs.readFileSync(path.join(output, `${prepared.archive}.sha256`), 'utf8') !== `${prepared.archiveSha256}  ${prepared.archive}\n`) {
    throw new Error(`The prepared default fork does not match the shipped pack. ${remedy}`);
  }
}

async function prepare(): Promise<void> {
  const shippedBuildRevision = shippedRevision();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-fork-preparation-'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const staged = fs.mkdtempSync(path.join(path.dirname(output), '.default-fork-'));
  try {
    const fork = path.join(temporary, 'fork');
    fs.cpSync(source, fork, { recursive: true,
      filter: file => !['node_modules', 'dist', '.apack', '.git'].includes(path.basename(file)) && !file.endsWith('.tsbuildinfo'),
    });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(fork, 'node_modules'), 'dir');
    const manifest = JSON.parse(fs.readFileSync(path.join(fork, 'apack.json'), 'utf8'));
    manifest.name = 'Acceptance fork';
    manifest.features.notes.surface.label = 'Fork Notes';
    fs.writeFileSync(path.join(fork, 'apack.json'), JSON.stringify(manifest, null, 2));
    const canvas = path.join(fork, 'src/features/notes/fe/canvas.vue');
    const original = fs.readFileSync(canvas, 'utf8');
    if (!original.includes('<template>')) throw new Error('Notes canvas has no template for the fork fixture');
    fs.writeFileSync(canvas, original.replace('<template>', '<template>\n  <div data-testid="fork-component">Fork component</div>'));
    const config = path.join(fork, 'tsconfig.json');
    fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace(
      '../../node_modules/.cache/tsbuildinfo/default-setup.tsbuildinfo', '.apack/typecheck.tsbuildinfo'));
    for (const [phase, args] of [['build', ['build']], ['archive', ['archive', '--out', staged]]] as const) {
      console.log(`Default fork ${phase}: starting (${DEFAULT_FORK_BUDGET_MS[phase] / 1000}s limit)`);
      const result = await boundedSpawn(process.execPath, [path.join(root, 'node_modules/.bin/apack'), 'pack', ...args], DEFAULT_FORK_BUDGET_MS[phase],
        { cwd: fork, env: { ...process.env, APACK_HOST: root }, stream: true });
      if (result.code !== 0) throw new Error(`Default fork ${phase} ${result.timedOut ? 'timed out' : `failed (exit ${result.code})`}`);
      console.log(`Default fork ${phase}: completed in ${(result.ms / 1000).toFixed(1)}s`);
    }
    if (shippedRevision() !== shippedBuildRevision) throw new Error('The shipped pack changed during fork preparation');
    const archive = `${manifest.id}-${manifest.version}.tgz`;
    if (!fs.existsSync(path.join(staged, archive)) || !fs.existsSync(path.join(staged, `${archive}.sha256`))) throw new Error('Fork archive or checksum is missing');
    const archiveSha256 = sha256File(path.join(staged, archive));
    fs.writeFileSync(path.join(staged, 'fork.json'), JSON.stringify({ shippedBuildRevision, archive, archiveSha256 }, null, 2) + '\n');
    fs.rmSync(output, { recursive: true, force: true });
    fs.renameSync(staged, output);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.rmSync(staged, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 0) await prepare();
  else if (args.length === 1 && args[0] === '--check') verifyDefaultPackFork();
  else throw new Error('Usage: tsx tests/scripts/prepare-default-pack-fork.ts [--check]');
}
