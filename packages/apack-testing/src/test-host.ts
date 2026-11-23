import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TestHostOptions {
  /** A built apack checkout to launch from source. */
  appRoot?: string;
  /** A packaged apack executable. */
  appExecutable?: string;
}

/** How the fixture launches apack: from a checkout's sources, or a packaged build. */
export type AppLaunch = { kind: 'source'; root: string } | { kind: 'packaged'; executable: string };

function isValidAppRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'packages', 'entry-point.mjs'));
}

function validateAppRoot(dir: string): void {
  const missing: string[] = [];
  if (!isValidAppRoot(dir)) missing.push('packages/entry-point.mjs');
  if (!fs.existsSync(path.join(dir, 'node_modules', 'electron'))) missing.push('node_modules/electron (run npm install)');
  if (!fs.existsSync(path.join(dir, 'packages', 'main', 'dist'))) missing.push('packages/main/dist (run npm run packs:stage && npm run build:runtime)');
  if (!fs.existsSync(path.join(dir, 'packages', 'renderer', 'dist'))) missing.push('packages/renderer/dist (run npm run packs:stage && npm run build:runtime)');
  if (missing.length > 0) {
    throw new Error(
      `apack checkout ${dir} is missing required files:\n` +
      missing.map(m => `  - ${m}`).join('\n') +
      '\n\nThe apack monorepo must be cloned, installed, and built before E2E tests can run.',
    );
  }
}

function sourceApp(dir: string): AppLaunch {
  const root = path.resolve(dir);
  validateAppRoot(root);
  return { kind: 'source', root: fs.realpathSync(root) };
}

function packagedApp(executable: string): AppLaunch {
  if (!fs.existsSync(executable)) throw new Error(`apack executable not found: ${executable}`);
  return { kind: 'packaged', executable: fs.realpathSync(executable) };
}

/** The CLI's resolved host is authoritative; standalone fixtures may supply their own host. */
export function resolveTestHost(options: TestHostOptions, env: NodeJS.ProcessEnv = process.env): AppLaunch {
  if (options.appExecutable && options.appRoot) throw new Error('Choose one test host identity.');
  if (env.APACK_HOST_ROOT && env.APACK_HOST_EXECUTABLE) throw new Error('Choose one resolved host identity.');
  const pinned = env.APACK_HOST_EXECUTABLE ? packagedApp(env.APACK_HOST_EXECUTABLE)
    : env.APACK_HOST_ROOT ? sourceApp(env.APACK_HOST_ROOT) : undefined;
  const requested = options.appExecutable ? packagedApp(options.appExecutable)
    : options.appRoot ? sourceApp(options.appRoot) : undefined;
  if (pinned && requested) {
    const same = pinned.kind === 'source' && requested.kind === 'source' ? pinned.root === requested.root
      : pinned.kind === 'packaged' && requested.kind === 'packaged' && pinned.executable === requested.executable;
    if (!same) throw new Error('Fixture host options conflict with the CLI-resolved host. Remove the options or select that host with --host.');
  }
  if (pinned) return pinned;
  if (requested) return requested;

  // Auto-detect: walk up from this package looking for packages/entry-point.mjs (inside the monorepo)
  let dir = path.resolve(import.meta.dirname, '..', '..');
  for (let i = 0; i < 10; i++) {
    if (isValidAppRoot(dir)) return sourceApp(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    'Could not find an apack app to test against. Run the tests with `apack pack test`, which ' +
    'resolves one (--host <path|beta>, or a release matching hostVersion), or set\n' +
    'APACK_HOST_ROOT to a built apack checkout.',
  );
}
