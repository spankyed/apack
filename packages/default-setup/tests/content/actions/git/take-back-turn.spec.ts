// An agent's turn as a checkpoint: the copy taken as a turn starts, what differs from it when the turn ends, which is
// every file the turn changed whatever wrote it, and taking the turn back, which leaves the files as they were before
// it, work the user had not committed included. The turn here is files written as an agent's tools and its shell
// would write them; everything else is the app's, over a real repository.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { featureSettings } from '#generated/settings.ts';
import { servicesForAction } from '#generated/services.ts';
import type { EntityId } from '#generated/services.ts';
import { checkpointTurn, turnChanges } from '../../../../src/content/actions/_helpers/turn-changes.ts';
import { action as takeBackTurn } from '../../../../src/content/actions/git/take-back-turn.ts';

const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const git = (cwd: string, ...args: string[]) =>
  execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd });

it('lists what a turn changed, and taking it back leaves the files as they were before it', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-turn-')));
  dirs.push(directory);
  const file = (name: string) => path.join(directory, name);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(file('a.txt'), 'committed\n');
  fs.writeFileSync(file('b.txt'), 'committed\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  // The user's own work, not committed, as the turn starts
  fs.writeFileSync(file('b.txt'), 'the user was editing this\n');
  fs.writeFileSync(file('notes.txt'), 'untracked notes\n');
  app = await startApp({ systems: ['code'] });
  featureSettings.forFeature('code').set({ path: ['baseDirectory'], value: directory });
  const services = servicesForAction('Take Back Turn');
  const before = Object.fromEntries(['a.txt', 'b.txt', 'notes.txt'].map(name => [name, fs.readFileSync(file(name), 'utf8')]));

  const checkpoint = await checkpointTurn(services);
  // The turn: an edit, an edit over the user's, a file deleted from a shell, and a file made
  fs.writeFileSync(file('a.txt'), 'changed by the agent\n');
  fs.writeFileSync(file('b.txt'), 'the agent rewrote it\n');
  fs.rmSync(file('notes.txt'));
  fs.writeFileSync(file('made.txt'), 'made by the agent\n');
  const turn = await turnChanges(services, checkpoint);

  expect(turn?.changes).toEqual([
    { path: 'a.txt', change: 'modified' },
    { path: 'b.txt', change: 'modified' },
    { path: 'made.txt', change: 'added' },
    { path: 'notes.txt', change: 'deleted' },
  ]);

  const { artifactId } = services.artifact.create({ artifactType: 'diff', title: 'the turn', content: { files: [], summary: '', turn } });
  expect(await takeBackTurn({ checkpoint: turn!.checkpoint, artifactId }, services)).toEqual({ success: true });

  expect(Object.fromEntries(Object.keys(before).map(name => [name, fs.readFileSync(file(name), 'utf8')]))).toEqual(before);
  expect(fs.existsSync(file('made.txt')), 'what the turn made is gone').toBe(false);
  expect((services.artifact.contentOf(artifactId as EntityId) as { turn: { takenBack?: boolean } }).turn.takenBack).toBe(true);
});
