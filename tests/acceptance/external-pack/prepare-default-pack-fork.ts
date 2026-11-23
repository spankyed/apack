import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPackBuild } from '@apackdev/host/packs';
import { checkoutShippedPacksDir, sha256File } from '@apackdev/host/packs/assets';
import { boundedSpawn } from '../../../scripts/lib/bounded-spawn.ts';
import { budgetMsFor } from '../../../scripts/lib/step-budgets.ts';

const root = fs.realpathSync.native(fileURLToPath(new URL('../../..', import.meta.url)));
const source = path.join(checkoutShippedPacksDir(root), 'default-setup');
const output = path.join(root, 'node_modules/.cache/apack-fixtures/default-fork');
const remedy = 'Run npm run test:external-pack:fork to prepare the default fork.';

// Shares of the bound on `test:external-pack:fork`, the step that runs this, so the phases fit inside it by
// construction. Each is a ceiling for a phase that spins: one that stops working is ended sooner, as stalled.
const FORK_STEP_MS = budgetMsFor('scenario');
export const DEFAULT_FORK_BUDGET_MS = {
  acquire: 0.25 * FORK_STEP_MS,
  build: 0.48 * FORK_STEP_MS,
  export: 0.17 * FORK_STEP_MS,
  housekeeping: 0.1 * FORK_STEP_MS,
} as const;

function shippedRevision(): string {
  return readPackBuild(source).revision;
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
    const { integrity } = readPackBuild(source);
    const { repo, commit } = integrity.provenance ?? {};
    if (!repo?.startsWith('https://github.com/') || !commit) {
      throw new Error('The released starter must identify its exact source checkout');
    }
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error('Run the fork scenario through npm');
    const acquire = async (command: string, args: string[], cwd: string, stream = true) => {
      const result = await boundedSpawn(command, args, DEFAULT_FORK_BUDGET_MS.acquire, { cwd, stream });
      if (result.code !== 0) throw new Error(`Default fork preparation failed: ${command} ${args.join(' ')}`);
      return result.output.trim();
    };
    await acquire('git', ['clone', '--depth', '1', '--branch', `v${integrity.version}`, repo, fork], temporary);
    if (await acquire('git', ['rev-parse', 'HEAD'], fork, false) !== commit) throw new Error('The pack release tag moved');
    await acquire(process.execPath, [npmCli, 'run', 'toolchain'], fork);
    await acquire(process.execPath, [npmCli, 'ci'], fork);
    const manifest = JSON.parse(fs.readFileSync(path.join(fork, 'apack.json'), 'utf8'));
    manifest.name = 'Acceptance fork';
    manifest.features.notes.surface.label = 'Fork Notes';
    fs.writeFileSync(path.join(fork, 'apack.json'), JSON.stringify(manifest, null, 2));
    const canvas = path.join(fork, 'src/features/notes/fe/canvas.vue');
    const original = fs.readFileSync(canvas, 'utf8');
    if (!original.includes('<template>')) throw new Error('Notes canvas has no template for the fork fixture');
    fs.writeFileSync(canvas, original.replace('<template>', '<template>\n  <div data-testid="fork-component">Fork component</div>'));
    for (const [phase, args] of [['build', ['run', 'build']], ['export', ['run', 'export', '--', '--out', staged]]] as const) {
      console.log(`Default fork ${phase}: starting (${DEFAULT_FORK_BUDGET_MS[phase] / 1000}s limit)`);
      const result = await boundedSpawn(process.execPath, [npmCli, ...args], DEFAULT_FORK_BUDGET_MS[phase],
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
  else throw new Error('Usage: tsx tests/acceptance/external-pack/prepare-default-pack-fork.ts [--check]');
}
