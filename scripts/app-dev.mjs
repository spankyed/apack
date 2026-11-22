// Repository-only entry point; load shared CLI internals through their TypeScript runtime.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { withCheckoutProfile } from './lib/dev-profile.mjs';

const [operation, ...args] = process.argv.slice(2);
const repositoryRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(repositoryRoot);
try {
  if (!args.includes('--help') && !args.includes('-h') && args.some(arg => /^--(?:app|host|build|channel)(?:=|$)/.test(arg))) {
    throw new Error('Repository scripts always use this checkout. Run the other checkout’s npm scripts to develop it.');
  }
  for (const key of ['APACK_HOST', 'APACK_APP', 'APACK_BUILD', 'APACK_CHANNEL', 'APACK_HOST_ROOT', 'APACK_HOST_EXECUTABLE']) delete process.env[key];
  if (operation === 'open') {
    if (args.includes('--help') || args.includes('-h')) {
      console.log(`App contributor tool: run from the root of the apack source monorepo.

Usage: npm run dev:open -- [--profile <name> | --fresh [--rm]] [--with-secrets]

Launch the built source app and hold its development session until Ctrl-C.
Always uses the apack checkout containing this script.
Linked worktrees default to their own profile; explicit profile flags override it.
Use npm run dev for source watchers and HMR.

Pack authors: run apack pack dev from your pack repository.`);
    } else {
      const { holdSession } = await tsImport('../packages/apack-cli/src/commands/dev.ts', import.meta.url);
      await holdSession(withCheckoutProfile(repositoryRoot, args), 'app');
    }
  } else if (operation === 'drive') {
    const { drive } = await tsImport('../packages/apack-cli/src/commands/drive.ts', import.meta.url);
    await drive(withCheckoutProfile(repositoryRoot, args), 'app', 'default-setup/database');
  } else throw new Error('Use npm run dev:open or npm run dev:drive.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
