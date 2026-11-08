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
    const git = async (...args: string[]) => (await execFileWhileWorking('git', args, { cwd: tmp })).stdout.trim();
    await git('init', '--quiet');
    await git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'init');
    await git('remote', 'add', 'origin', 'https://author:ghp_secret@github.com/acme/demo-pack.git');

    expect(gitProvenance(tmp)).toEqual({ commit: await git('rev-parse', 'HEAD'), repo: 'https://github.com/acme/demo-pack.git' });
  });
});
