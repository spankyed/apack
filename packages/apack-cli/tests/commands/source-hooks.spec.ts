import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

/** The CLI's source-mode resolve hooks add @apackdev/source only for packages in the checkout */
const HOOKS = pathToFileURL(path.resolve(__dirname, '..', '..', 'bin', 'source-hooks.mjs')).href;

const MANIFEST = JSON.stringify({
  name: '@apackdev/sdk',
  type: 'module',
  exports: { '.': { '@apackdev/source': './src/index.js', default: './dist/index.js' } },
});

let root: string;
let checkout: string;

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function link(target: string, from: string): void {
  fs.mkdirSync(path.join(from, 'node_modules', '@apackdev'), { recursive: true });
  fs.symlinkSync(target, path.join(from, 'node_modules', '@apackdev', 'sdk'), 'dir');
}

/** What @apackdev/sdk resolves to from `dir` in a Node process with the hooks registered */
async function resolveWithHooks(dir: string): Promise<string> {
  const script = [
    "import { register } from 'node:module';",
    `register(${JSON.stringify(HOOKS)}, { data: { checkout: ${JSON.stringify(pathToFileURL(checkout).href + '/')} } });`,
    "process.stdout.write(import.meta.resolve('@apackdev/sdk'));",
  ].join('\n');
  const { stdout: url } = await execFileWhileWorking(process.execPath, ['--input-type=module', '-e', script], {
    cwd: dir, env: { PATH: process.env.PATH },
  });
  return path.relative(root, new URL(url).pathname);
}

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-source-hooks-')));
  checkout = path.join(root, 'checkout');
  const workspaceSdk = path.join(checkout, 'packages', 'apack-sdk');
  write(path.join(workspaceSdk, 'package.json'), MANIFEST);
  write(path.join(workspaceSdk, 'src', 'index.js'), 'export {};');
  write(path.join(workspaceSdk, 'dist', 'index.js'), 'export {};');
  link(workspaceSdk, checkout);

  // A pack with its own installed SDK, inside and outside the checkout. The copy has a src too, so
  // only the package's location keeps it on dist
  for (const pack of [path.join(root, 'installed-pack'), path.join(checkout, 'tests', 'installed-pack')]) {
    const installed = path.join(pack, 'node_modules', '@apackdev', 'sdk');
    write(path.join(installed, 'package.json'), MANIFEST);
    write(path.join(installed, 'src', 'index.js'), 'export {};');
    write(path.join(installed, 'dist', 'index.js'), 'export {};');
  }
  // A pack outside the checkout linked to its workspace SDK
  fs.mkdirSync(path.join(root, 'linked-pack'));
  link(workspaceSdk, path.join(root, 'linked-pack'));
  // A pack linked to another checkout than the one running the CLI
  const otherSdk = path.join(root, 'other-checkout', 'packages', 'apack-sdk');
  write(path.join(otherSdk, 'package.json'), MANIFEST);
  write(path.join(otherSdk, 'src', 'index.js'), 'export {};');
  write(path.join(otherSdk, 'dist', 'index.js'), 'export {};');
  fs.mkdirSync(path.join(root, 'other-linked-pack'));
  link(otherSdk, path.join(root, 'other-linked-pack'));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('CLI source hooks', () => {
  it('resolve the checkout workspace package to its source', async () => {
    expect(await resolveWithHooks(checkout)).toBe('checkout/packages/apack-sdk/src/index.js');
  });

  it('resolve a linked pack to the checkout source', async () => {
    expect(await resolveWithHooks(path.join(root, 'linked-pack'))).toBe('checkout/packages/apack-sdk/src/index.js');
  });

  it("leave another checkout's package on its dist", async () => {
    expect(await resolveWithHooks(path.join(root, 'other-linked-pack'))).toBe('other-checkout/packages/apack-sdk/dist/index.js');
  });

  it('leave an installed package outside the checkout on its dist', async () => {
    expect(await resolveWithHooks(path.join(root, 'installed-pack'))).toBe('installed-pack/node_modules/@apackdev/sdk/dist/index.js');
  });

  it('leave an installed package inside the checkout on its dist', async () => {
    expect(await resolveWithHooks(path.join(checkout, 'tests', 'installed-pack'))).toBe('checkout/tests/installed-pack/node_modules/@apackdev/sdk/dist/index.js');
  });
});
