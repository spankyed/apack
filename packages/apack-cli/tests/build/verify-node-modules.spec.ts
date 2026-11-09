import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

const SCRIPT = path.resolve(__dirname, '..', '..', '..', '..', 'build', 'prod', 'verify-node-modules.mjs');

let tmp: string | undefined;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function pkg(dir: string, manifest: Record<string, unknown>) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
}

async function verify(app: string, workspace: string): Promise<{ code: number; output: string }> {
  try {
    return { code: 0, output: (await execFileWhileWorking(process.execPath, [SCRIPT, app, workspace])).stdout };
  } catch (err: any) {
    return { code: err.code ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('verify-node-modules.mjs', () => {
  it("fails when the bundled CLI's dependencies or a platform binary are missing from the app", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-node-modules-'));
    const app = path.join(tmp, 'app');
    const workspace = path.join(tmp, 'workspace');
    pkg(app, { name: 'app' });
    pkg(path.join(app, 'node_modules', 'esbuild'), { name: 'esbuild', optionalDependencies: { '@esbuild/darwin-arm64': '1.0.0', '@esbuild/win32-x64': '1.0.0' } });
    pkg(path.join(app, 'packages', 'apack-cli', 'dist', 'package'), { name: '@apackdev/cli', dependencies: { vite: '^7', esbuild: '^0.25' } });
    pkg(path.join(workspace, 'node_modules', '@esbuild', 'darwin-arm64'), { name: '@esbuild/darwin-arm64' });

    const result = await verify(app, workspace);
    expect(result.code).toBe(1);
    expect(result.output).toContain('packages/apack-cli/dist/package → vite');
    expect(result.output).toContain('node_modules/esbuild → @esbuild/darwin-arm64 (optional, installed for this platform)');
    expect(result.output).not.toContain('win32-x64');

    pkg(path.join(app, 'node_modules', 'vite'), { name: 'vite' });
    pkg(path.join(app, 'node_modules', '@esbuild', 'darwin-arm64'), { name: '@esbuild/darwin-arm64' });
    expect(await verify(app, workspace)).toMatchObject({ code: 0 });
  });
});
