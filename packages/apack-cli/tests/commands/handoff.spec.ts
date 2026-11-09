import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

const CLI = path.resolve(__dirname, '..', '..', 'bin', 'apack.mjs');

let tmp: string | undefined;

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

async function run(cwd: string, args: string[]): Promise<string> {
  return (await execFileWhileWorking('node', [CLI, ...args], { cwd })).stdout;
}

describe('apack bin hand-off', () => {
  it('runs the @apackdev/cli the project pins instead of itself', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-handoff-'));
    const projectCli = path.join(tmp, 'node_modules', '@apackdev', 'cli');
    fs.mkdirSync(path.join(projectCli, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(projectCli, 'package.json'), JSON.stringify({ name: '@apackdev/cli', version: '9.9.9' }));
    fs.writeFileSync(
      path.join(projectCli, 'bin', 'apack.mjs'),
      "console.log('project cli ' + process.argv.slice(2).join(' '));\n",
    );
    const nested = path.join(tmp, 'src');
    fs.mkdirSync(nested);

    expect((await run(nested, ['--version'])).trim()).toBe('project cli --version');
  });

  it('runs itself when the project resolves @apackdev/cli to this CLI', async () => {
    // The monorepo links node_modules/@apackdev/cli to this package
    const own = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf-8'));

    expect((await run(path.resolve(__dirname, '..'), ['--version'])).trim()).toBe(own.version);
  });

  it('runs itself when the project has no @apackdev/cli', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-handoff-'));
    const own = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf-8'));

    expect((await run(tmp, ['--version'])).trim()).toBe(own.version);
  });
});
