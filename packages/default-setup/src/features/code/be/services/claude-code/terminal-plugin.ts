import type { ApackNativePluginConfig } from './native-plugin/program.ts';
import { CLAUDE_NATIVE_PLUGIN_PROGRAM } from './native-plugin/program.generated.ts';

/**
 * The plugin module the app writes into a CLI plugin directory.
 *
 * **Code above, data below — and only the data is built here.** The program is
 * `native-plugin/entry.ts` bundled (`npm run plugin:update -w @app/default-setup`), so it is typechecked,
 * linted and unit-driven with a fake `$` like any other module; this function only prepends the one
 * declaration that differs between runs, which the program reads as `APACK_NATIVE_CONFIG`.
 */
export function createClaudeTerminalPlugin(
  socketPath: string,
  token: string,
  background: ApackNativePluginConfig['background'],
): string {
  const config: ApackNativePluginConfig = { socketPath, token, background };
  return 'const APACK_NATIVE_CONFIG = ' + JSON.stringify(config) + ';\n' + CLAUDE_NATIVE_PLUGIN_PROGRAM;
}
