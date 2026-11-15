// An SSH host alias named by a remote, resolved as ssh itself resolves it — a real `ssh -G` over an SSH config of
// the case's own — to the repository on GitHub it names, and never handed to ssh where it could be read as an option.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { gitHubRepoOf, resolveSshHost } from '#features/code/be/services/ssh-host.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

const hasSsh = await execFileWhileWorking('ssh', ['-V'], { timeout: 5_000 }).then(() => true, () => false);

/** An SSH config holding `text`, as a user's would */
function sshConfig(text: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-config-'));
  dirs.push(dir);
  const file = path.join(dir, 'config');
  fs.writeFileSync(file, text);
  return file;
}

const WEB = 'https://github.com';

it.skipIf(!hasSsh)('names the repository behind an alias ssh connects to GitHub, and nothing behind one it connects elsewhere', async () => {
  const configFile = sshConfig([
    'Host github-work', '  HostName github.com', '  User git', '  IdentityFile ~/.ssh/work',
    'Host github_personal', '  HostName github.com',
    'Host github-443', '  HostName ssh.github.com', '  Port 443',
    'Host gitlab-work', '  HostName gitlab.com',
  ].join('\n'));

  expect(await gitHubRepoOf('git@github-work:octo/repo.git', WEB, { configFile })).toEqual({ owner: 'octo', name: 'repo' });
  expect(await gitHubRepoOf('ssh://github-443/octo/repo', WEB, { configFile })).toEqual({ owner: 'octo', name: 'repo' });
  expect(await gitHubRepoOf('git@github_personal:octo/repo.git', WEB, { configFile }), 'an alias may hold an underscore').toEqual({ owner: 'octo', name: 'repo' });
  expect(await resolveSshHost('github-443', { configFile })).toEqual({ hostname: 'ssh.github.com', port: 443 });
  expect(await gitHubRepoOf('git@gitlab-work:octo/repo.git', WEB, { configFile })).toBeUndefined();
  expect(await gitHubRepoOf('git@unaliased:octo/repo.git', WEB, { configFile }), 'a host no alias names is itself').toBeUndefined();
});

it.skipIf(!hasSsh)('asks ssh again once the SSH config changes', async () => {
  const configFile = sshConfig('Host github-work\n  HostName gitlab.com\n');
  expect(await gitHubRepoOf('git@github-work:octo/repo.git', WEB, { configFile })).toBeUndefined();

  fs.writeFileSync(configFile, 'Host github-work\n  HostName github.com\n');
  const later = new Date(Date.now() + 5_000);
  fs.utimesSync(configFile, later, later);
  expect(await gitHubRepoOf('git@github-work:octo/repo.git', WEB, { configFile })).toEqual({ owner: 'octo', name: 'repo' });
});

// ssh, handed the host after `--`, refuses a dash-led one too: this case fires only were both the `isSshHost` check
// and the `--` dropped
it('hands ssh no host it would read as an option, and no address that is a path', async () => {
  const configFile = sshConfig('Host *\n  HostName github.com\n');
  expect(await resolveSshHost('-oProxyCommand=touch /tmp/x', { configFile })).toBeUndefined();
  expect(await gitHubRepoOf('-oProxyCommand=x:octo/repo', WEB, { configFile })).toBeUndefined();
  expect(await gitHubRepoOf('/srv/git/repo.git', WEB, { configFile })).toBeUndefined();
  expect(await gitHubRepoOf('C:/repos/repo.git', WEB, { configFile }), 'a Windows drive is a path').toBeUndefined();
});
