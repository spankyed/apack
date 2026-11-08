import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

const LAUNCHER = path.resolve(__dirname, '..', '..', 'bin', 'app-launcher.sh');

let tmp: string | undefined;

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe.skipIf(process.platform === 'win32')('app-bundled apack launcher', () => {
  it('runs the bundled CLI through the app executable as Node, via the PATH symlink', async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-launcher-')));
    const contents = path.join(tmp, 'apack Beta.app', 'Contents');
    const executable = path.join(contents, 'MacOS', 'apack Beta');
    const launcher = path.join(contents, 'Resources', 'cli', 'apack');
    const cliBin = path.join(contents, 'Resources', 'app', 'packages', 'apack-cli', 'dist', 'package', 'bin', 'apack.mjs');

    // Stands in for Electron: reports how it was started
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, '#!/bin/sh\necho "ELECTRON_RUN_AS_NODE=$ELECTRON_RUN_AS_NODE"\nfor a in "$@"; do echo "arg=$a"; done\n');
    fs.chmodSync(executable, 0o755);
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.copyFileSync(LAUNCHER, launcher);
    fs.chmodSync(launcher, 0o755);
    fs.mkdirSync(path.dirname(cliBin), { recursive: true });
    fs.writeFileSync(cliBin, '');

    const binDir = path.join(tmp, 'usr-local-bin');
    fs.mkdirSync(binDir);
    fs.symlinkSync(launcher, path.join(binDir, 'apack'));

    const { stdout: output } = await execFileWhileWorking(path.join(binDir, 'apack'), ['pack', 'build', '--release'], { env: { PATH: process.env.PATH } });

    expect(output.trim().split('\n')).toEqual([
      'ELECTRON_RUN_AS_NODE=1',
      `arg=${cliBin}`,
      'arg=pack',
      'arg=build',
      'arg=--release',
    ]);
  });
});
