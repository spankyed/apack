import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitProvenance } from '../../src/commands/archive';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

let tmp: string | undefined;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe('gitProvenance (integrity.json provenance)', () => {
  it("records the origin without credentials an https remote carries", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-source-'));
    const git = async (...args: string[]) => (await execFileWhileWorking('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: tmp })).stdout.trim();
    await git('init', '--quiet');
    await git('commit', '--quiet', '--allow-empty', '-m', 'init');
    await git('remote', 'add', 'origin', 'https://author:ghp_secret@github.com/acme/demo-pack.git');

    expect(gitProvenance(tmp)).toEqual({ commit: await git('rev-parse', 'HEAD'), repo: 'https://github.com/acme/demo-pack.git' });

    fs.writeFileSync(path.join(tmp, '.gitignore'), 'public/local.txt\n');
    await git('add', '.gitignore');
    await git('commit', '-m', 'ignore local file');
    fs.mkdirSync(path.join(tmp, 'public'));
    fs.writeFileSync(path.join(tmp, 'public', 'local.txt'), 'ignored pack input');
    expect(await git('status', '--porcelain')).toBe('');
    expect(gitProvenance(tmp)).toBeUndefined();
    await git('add', '-f', 'public/local.txt');
    await git('commit', '-m', 'commit the pack input');
    expect(gitProvenance(tmp)?.commit).toBe(await git('rev-parse', 'HEAD'));

    fs.writeFileSync(path.join(tmp, 'source.ts'), 'uncommitted input');
    expect(gitProvenance(tmp)).toBeUndefined();
  });
});
