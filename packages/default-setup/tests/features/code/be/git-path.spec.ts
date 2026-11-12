// The panel runs the git the user set, or the first one installed where git usually is, and when that git cannot
// be used it says why and what to do. Driven through the code system as a window drives it, over a real repository.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { featureSettings } from '#generated/settings.ts';
import { resolveGitPath } from '#features/code/be/utils/resolve-cli.ts';

const CODE = 'default-setup/code';
const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const asWindow = { sender: CODE, client: 'c-main' };

it('says there is no git where the user set it, and what to do about it', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-git-path-')));
  dirs.push(directory);
  await execFileWhileWorking('git', ['init', '--quiet', '--initial-branch=main'], { cwd: directory });
  const nowhere = path.join(directory, 'no-git-here');
  featureSettings.forFeature('code').set({ path: ['cliPaths', 'git'], value: nowhere });
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();

  const asked = await app.send('code', { type: 'commit.GET_GIT_STATUS' }, asWindow);

  const { data } = await app.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: asked });
  expect(data).toMatchObject({ code: 'git-not-found' });
  expect((data as { message: string }).message).toContain(nowhere);
  expect((data as { message: string }).message).toContain('Settings, CLI providers');
});

it('takes the path the user set as it is, and otherwise one that is there', () => {
  expect(resolveGitPath(' /opt/tools/git ')).toBe('/opt/tools/git');
  const found = resolveGitPath('');
  expect(found === 'git' || fs.existsSync(found)).toBe(true);
});
