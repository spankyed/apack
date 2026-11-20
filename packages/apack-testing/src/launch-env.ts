import * as path from 'node:path';
import { withoutSourceCondition } from '@apackdev/host/build/source-resolution';

/**
 * Where the app under test's zsh looks for the developer's own configuration: a directory under the run's data
 * dir that nothing creates, so there is none. Bash's is `bashConfigFile`.
 *
 * **A terminal case times the app, not the developer's dotfiles.** The app's shell wrapper sources the user's
 * `.zshenv` and `.zshrc` from `ZDOTDIR` (`shell-integration.ts` in default-setup), and a framework-laden one took
 * 2–7 s to start under load where an empty one takes a tenth of a second, inside a case's wait for the first
 * command to run. Git is kept from the machine's config the same way (`vitest-git-config.ts`).
 *
 * **Named, not done by moving `HOME`**, which would move git's config, the keychain and Electron's own paths with
 * it: zsh takes `ZDOTDIR`, and the app's bash wrapper takes `APACK_BASHRC` in place of `$HOME/.bashrc`.
 */
const zshConfigDir = (userDataDir: string): string => path.join(userDataDir, 'zsh-config');

/** The same for bash: the file the app's bash wrapper sources in place of `$HOME/.bashrc` (`APACK_BASHRC`), which is not there */
const bashConfigFile = (userDataDir: string): string => path.join(userDataDir, 'bash-config', '.bashrc');

/**
 * Env for the Electron app under test. The app-bundled `apack` runs on the app's own
 * runtime with ELECTRON_RUN_AS_NODE=1; inherited here it would start Electron as plain Node.
 * The runner's @apackdev/source condition isn't passed on: a checkout's app sets its own. Its zsh reads none of
 * the developer's configuration (`zshConfigDir`).
 */
export function appLaunchEnv(base: NodeJS.ProcessEnv, userDataDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  const nodeOptions = withoutSourceCondition(env.NODE_OPTIONS);
  if (nodeOptions) env.NODE_OPTIONS = nodeOptions;
  else delete env.NODE_OPTIONS;
  env.PLAYWRIGHT_TEST = 'true';
  env.APACK_USER_DATA_DIR = userDataDir;
  env.ZDOTDIR = zshConfigDir(userDataDir);
  env.APACK_BASHRC = bashConfigFile(userDataDir);
  return env;
}

/**
 * Whether to pin the page's viewport, which is a question about whether anyone is looking at the window.
 *
 * Pinned, layout and `toHaveScreenshot` baselines are the same everywhere, which a suite needs because the
 * main window's default size depends on whether main was built in dev or production mode.
 *
 * **But Playwright emulates a viewport inside the real window rather than resizing it.** With the window
 * shown, the app renders into the top-left 1400x900 and the rest of the window stays empty, showing the
 * desktop through it — which is what `npm run dev:drive` looked like, and reads as a broken app rather than a
 * pinned one. So a run that shows its windows keeps the window's own size, and a run nobody watches keeps
 * the determinism.
 */
export const pinsViewport = (env: NodeJS.ProcessEnv): boolean => env.PLAYWRIGHT_VISIBLE !== '1';
