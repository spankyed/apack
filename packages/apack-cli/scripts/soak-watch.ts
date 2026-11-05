// `npm run soak:watch -- [--rounds N] [--max-delay SECONDS]`: does an edit made during a watcher pass still get picked up?
//
// The real watcher over the real inputs of this checkout, with a stand-in for what a pass builds, so no compiler runs. Each
// round edits one package file, which starts a pass, and edits another at a random moment within it. Worth running on
// a Mac under load, which is where file events are slow. Exit 1 when an edit was lost, 3 when stalled rounds leave the
// answer partial. It writes two untracked files under apack-testing/src and removes them.
import { fork } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { startPackBuildWatcher } from '../src/build/watch.ts';
import { judgeSoak, type SoakRound } from './soak-rounds.ts';

const AFTER_BYSTANDER_MS = 150_000;
const GIVE_UP_MS = 300_000;
const BETWEEN_ROUNDS_MS = 2_000;

const { values } = parseArgs({ options: { rounds: { type: 'string', default: '24' }, 'max-delay': { type: 'string', default: '30' } } });
const roundCount = Number(values.rounds);
const maxDelayMs = Number(values['max-delay']) * 1000;

const directory = path.join(REPO_ROOT, 'packages/apack-testing/src');
const probe = path.join(directory, '__soak-probe.ts');
const driver = path.join(directory, '__soak-driver.ts');
for (const file of [probe, driver]) {
  if (fs.existsSync(file)) throw new Error(`${file} exists: another soak is running, or one was killed. Remove it to go on.`);
}
const removeProbes = () => { for (const file of [probe, driver]) fs.rmSync(file, { force: true }); };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const stopping = new AbortController();
for (const name of ['SIGINT', 'SIGTERM'] as const) process.once(name, () => stopping.abort());

fs.writeFileSync(probe, '// 0\n');
fs.writeFileSync(driver, '// 0\n');
const bystander = fork(path.join(import.meta.dirname, 'soak-bystander.mjs'), [directory, probe], { execArgv: [] });
let bystanderEventAt = 0;
let wroteAt = 0;
let wroteText = '';
const bystanderReady = new Promise<void>(resolve => {
  bystander.on('message', (message: { type: string; text?: string }) => {
    if (message.type === 'ready') resolve();
    if (message.type === 'event') bystanderEventAt = Date.now();
    if (message.type === 'wrote') { wroteAt = Date.now(); wroteText = message.text!; }
  });
});

// In the watcher's process, so on its file-event stream. For a lost edit this says which side lost it: the event reached
// that stream and the watcher dropped it, or it never reached that stream though it reached the bystander's.
let streamEventAt = 0;
const streamWitness = fs.watch(directory, { recursive: true }, (_event, file) => {
  if (file && path.join(directory, file) === probe) streamEventAt = Date.now();
});

let ensured = '';
const builder = {
  async ensurePackages() { ensured = fs.readFileSync(probe, 'utf8'); },
  async build() {},
  subscribeFrontendInputs() { return () => {}; },
  async isFrontendCurrent() { return true; },
};

const rounds: SoakRound[] = [];
let watcher: Awaited<ReturnType<typeof startPackBuildWatcher>> | undefined;
try {
  await bystanderReady;
  watcher = await startPackBuildWatcher(path.join(REPO_ROOT, 'packages/default-setup'), {
    builder, signal: stopping.signal, onBuilt: async () => ({ status: 'current' }),
  });
  for (let round = 1; round <= roundCount && !stopping.signal.aborted; round++) {
    const text = `// ${round}\n`;
    const delayMs = Math.round(Math.random() * maxDelayMs);
    bystander.send({ text, delayMs });
    fs.writeFileSync(driver, text);
    while (wroteText !== text && !stopping.signal.aborted) await sleep(100);
    const saved = wroteAt;
    while (!stopping.signal.aborted && ensured !== text && Date.now() - saved < GIVE_UP_MS) {
      if (bystanderEventAt >= saved && Date.now() - bystanderEventAt > AFTER_BYSTANDER_MS) break;
      await sleep(250);
    }
    if (stopping.signal.aborted) break;
    const result: SoakRound = { pickedUp: ensured === text, bystanderSaw: bystanderEventAt >= saved };
    rounds.push(result);
    console.log(JSON.stringify({ round, delayMs, ...result, watcherStreamSaw: streamEventAt >= saved, afterMs: Date.now() - saved, load: Number(os.loadavg()[0].toFixed(0)) }));
    await sleep(BETWEEN_ROUNDS_MS);
  }
} finally {
  await watcher?.close().catch(() => {});
  streamWitness.close();
  bystander.disconnect();
  removeProbes();
}
const result = judgeSoak(rounds);
console.log(`[soak] ${result.rounds} rounds: ${result.pickedUp} picked up, ${result.lost} lost, ${result.stalled} stalled (no process received the event)`);
process.exit(result.exitCode);
