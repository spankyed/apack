// `npm run soak:watch -- [--rounds N] [--max-delay SECONDS] [--files-only]`: does an edit made during a watcher pass
// still get picked up?
//
// The real watcher over the real inputs of this checkout, with a stand-in for what a pass builds, so no compiler runs. Each
// round edits one package file, which starts a pass, and edits another at a random moment within it. Worth running on
// a Mac under load, which is where file events are slow. Exit 1 when an edit was lost, 3 when stalled rounds leave the
// answer partial. It writes two untracked files under apack-testing/src and removes them.
//
// `--files-only` runs the watcher with no directory watches, so every edit it picks up came through the file watches
// on known inputs, and any it misses is lost. Each round also reports how long each FSEvents route took to see the
// edit, or that it hadn't by the round's end: the bystander's `fs.watch` and Vite's chokidar.
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

const { values } = parseArgs({ options: {
  rounds: { type: 'string', default: '24' }, 'max-delay': { type: 'string', default: '30' }, 'files-only': { type: 'boolean', default: false },
} });
const roundCount = Number(values.rounds);
const maxDelayMs = Number(values['max-delay']) * 1000;
const filesOnly = values['files-only'];
if (filesOnly && process.platform !== 'darwin') throw new Error('--files-only needs macOS: the watcher keeps file watches only there');

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
let viteEventAt = 0;
let wroteAt = 0;
let wroteText = '';
const bystanderReady = new Promise<void>(resolve => {
  bystander.on('message', (message: { type: string; text?: string; at?: number }) => {
    if (message.type === 'ready') resolve();
    if (message.type === 'event') bystanderEventAt = message.at!;
    if (message.type === 'vite-event') viteEventAt = message.at!;
    if (message.type === 'wrote') { wroteAt = message.at!; wroteText = message.text!; }
  });
});

// In the watcher's process, so on its file-event stream. For a lost edit this says which side lost it: the event reached
// that stream and the watcher dropped it, or it never reached that stream though it reached the bystander's.
// The probe is written once a round, so any event since the round began is that write's; a timestamp couldn't say, since
// this process blocks during an input read and learns of the write late.
let streamSawProbe = false;
const streamWitness = fs.watch(directory, { recursive: true }, (_event, file) => {
  if (file && path.join(directory, file) === probe) streamSawProbe = true;
});

let ensured = '';
let passes = 0;
const builder = {
  async ensurePackages() { passes++; ensured = fs.readFileSync(probe, 'utf8'); },
  async build() {},
  subscribeFrontendInputs() { return () => {}; },
  async isFrontendCurrent() { return true; },
};

const rounds: SoakRound[] = [];
const routes: Array<{ fsWatchMs: number | null; viteRouteMs: number | null; pickedUp: boolean }> = [];
let watcher: Awaited<ReturnType<typeof startPackBuildWatcher>> | undefined;
try {
  await bystanderReady;
  watcher = await startPackBuildWatcher(path.join(REPO_ROOT, 'packages/default-setup'), {
    builder, signal: stopping.signal, onBuilt: async () => ({ status: 'current' }), directoryWatches: !filesOnly,
  });
  for (let round = 1; round <= roundCount && !stopping.signal.aborted; round++) {
    const text = `// ${round}\n`;
    streamSawProbe = false;
    const passesBefore = passes;
    const delayMs = Math.round(Math.random() * maxDelayMs);
    const replace = round % 2 === 0;
    bystander.send({ text, delayMs, replace });
    fs.writeFileSync(driver, text);
    while (wroteText !== text && !stopping.signal.aborted) await sleep(100);
    const saved = wroteAt;
    while (!stopping.signal.aborted && ensured !== text && Date.now() - saved < GIVE_UP_MS) {
      if (!filesOnly && bystanderEventAt >= saved && Date.now() - bystanderEventAt > AFTER_BYSTANDER_MS) break;
      await sleep(250);
    }
    if (stopping.signal.aborted) break;
    const result: SoakRound = { pickedUp: ensured === text, bystanderSaw: bystanderEventAt >= saved };
    rounds.push(result);
    const fsWatchMs = bystanderEventAt >= saved ? bystanderEventAt - saved : null;
    const viteRouteMs = viteEventAt >= saved ? viteEventAt - saved : null;
    routes.push({ fsWatchMs, viteRouteMs, pickedUp: result.pickedUp });
    console.log(JSON.stringify({ round, save: replace ? 'replace' : 'in place', delayMs, ...result, fsWatchMs, viteRouteMs, watcherStreamSaw: streamSawProbe, passes: passes - passesBefore, afterMs: Date.now() - saved, load: Number(os.loadavg()[0].toFixed(0)) }));
    await sleep(BETWEEN_ROUNDS_MS);
  }
} finally {
  await watcher?.close().catch(() => {});
  streamWitness.close();
  bystander.disconnect();
  removeProbes();
}
const result = judgeSoak(rounds, { filesOnly });
console.log(`[soak] ${result.rounds} rounds${filesOnly ? ' (file watches only)' : ''}: ${result.pickedUp} picked up, ${result.lost} lost, ${result.stalled} stalled (no process received the event)`);
for (const [name, key] of [['fs.watch', 'fsWatchMs'], ['Vite (chokidar)', 'viteRouteMs']] as const) {
  const unseen = routes.filter(route => route[key] === null);
  const seen = routes.flatMap(route => route[key] === null ? [] : [route[key]]).sort((a, b) => a - b);
  console.log(`[soak] ${name}: ${unseen.length} rounds unseen by the round's end (${unseen.filter(route => route.pickedUp).length} of them picked up anyway); slowest seen ${seen.at(-1) ?? '-'} ms`);
}
process.exit(result.exitCode);
