import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { describeRefusal, processWork, watchWork } from '@apackdev/sdk/progress';

/** The CPU the load may spend: loading a bundle is short, and only one that spins reaches this */
const LOAD_CPU_MS = 60_000;
/**
 * Optional @apackdev/sdk peers every dependent's unit tests have: @apackdev/testing/harness compiles
 * content with @apackdev/sdk/build, which needs them (the scaffold installs typescript; @apackdev/testing's
 * tsx brings esbuild).
 */
const HARNESS_PEERS = ['typescript', 'esbuild'];

// Resolve hook for the check: @apackdev/sdk's optional peers aren't installed for every dependent
const BLOCK_OPTIONAL_PEERS_HOOK = `
let blocked = [];
export function initialize(data) { blocked = data.blocked; }
export async function resolve(specifier, context, next) {
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  if (blocked.includes(name)) {
    throw new Error(\`\${context.parentURL} imports "\${specifier}", an optional peer of @apackdev/sdk that packs depending on this one may not have installed\`);
  }
  return next(specifier, context);
}
`;

// What a dependent's unit tests do with the bundle (@apackdev/testing/harness setupPackTests)
const LOAD_SCRIPT = `
import { register } from 'node:module';
const [hook, bundle, blocked] = JSON.parse(process.env.APACK_CONTENT_RUNTIME_CHECK);
register(hook, { data: { blocked } });
const { registerContentRuntime, startTestRuntime } = await import('@apackdev/sdk/testing');
startTestRuntime();
const { contentRuntime } = await import(bundle);
registerContentRuntime(contentRuntime);
`;

/** @apackdev/sdk's optional peer dependencies a dependent's unit tests may not have, as the pack resolves the SDK */
function missingSdkPeers(packDir: string): string[] {
  const manifest = createRequire(path.join(packDir, 'package.json')).resolve('@apackdev/sdk/package.json');
  const { peerDependenciesMeta = {} } = JSON.parse(fs.readFileSync(manifest, 'utf-8')) as {
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  };
  return Object.entries(peerDependenciesMeta)
    .filter(([name, meta]) => meta.optional && !HARNESS_PEERS.includes(name))
    .map(([name]) => name);
}

/**
 * Loads a built content runtime the way a dependent's unit tests do: in a fresh Node process, with
 * only the pack's @apackdev/sdk and none of the SDK's optional peers the harness doesn't need. A bundle that can't load there
 * (a native module, an optional peer, code that needs the app) fails the build instead of a
 * dependent's tests.
 */
export async function checkContentRuntimeLoads(
  packDir: string,
  bundleFile: string,
  { tmpDir = os.tmpdir() }: { tmpDir?: string } = {},
): Promise<{ success: boolean; error?: string }> {
  // The load's user data dir, removed after
  const dataDir = fs.mkdtempSync(path.join(tmpDir, 'apack-content-runtime-check-'));
  try {
    const args = [
      // The bundle loads the packages' published dist, as a dependent's tests do
      '--input-type=module',
      '--eval',
      LOAD_SCRIPT,
    ];
    let blocked: string[];
    try {
      blocked = missingSdkPeers(packDir);
    } catch (err) {
      return {
        success: false,
        error: `${path.relative(packDir, bundleFile)} can't be checked: @apackdev/sdk doesn't resolve from ${packDir} (install the pack's dependencies).\n${errorMessage(err)}`,
      };
    }
    const check = JSON.stringify([`data:text/javascript,${encodeURIComponent(BLOCK_OPTIONAL_PEERS_HOOK)}`, pathToFileURL(bundleFile).href, blocked]);

    const { code, output, ended } = await new Promise<{ code: number | null; output: string; ended?: string }>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: packDir,
        // Test the published runtime independently of compiler initialization. Replaying compiler
        // hooks can supply globals or loaders a dependent does not have and falsely accept the bundle.
        env: {
          ...process.env,
          NODE_OPTIONS: undefined,
          APACK_ENV: 'test',
          APACK_USER_DATA_DIR: dataDir,
          APACK_CONTENT_RUNTIME_CHECK: check,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      // Bounded by its progress: ended when it stalls or spins, never because the machine is busy
      let ended: string | undefined;
      const watch = child.pid === undefined ? undefined : watchWork({
        work: processWork(child.pid), ceilingMs: LOAD_CPU_MS, fallbackMs: LOAD_CPU_MS,
        onRefused: (refusal) => { ended = describeRefusal(refusal); child.kill('SIGKILL'); },
      });
      let output = '';
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.on('error', (error) => { watch?.stop(); reject(error); });
      child.on('close', (exitCode) => { watch?.stop(); resolve({ code: exitCode, output, ended }); });
    });
    if (code === 0) return { success: true };
    const reason = output.trim() || (ended === undefined ? `the load exited with code ${code}` : `the load was ended: it ${ended}`);
    return {
      success: false,
      error: `${path.relative(packDir, bundleFile)} doesn't load outside the app. Packs depending on this one load it in their unit tests with only @apackdev/sdk installed, so repositories and content writers can't use native modules or @apackdev/sdk's optional peers (${blocked.join(', ')}).\n${reason}`,
    };
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
