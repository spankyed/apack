/**
 * What the CLI loads: the one export its `hooks.json` names.
 *
 * **Only data is interpolated.** `createClaudeTerminalPlugin` writes a `const APACK_NATIVE_CONFIG = {…}`
 * line above the bundled program, so the sockets and tokens a run needs arrive as a value and the program
 * itself is the same bytes every run — which is what makes the built program a recorded file that a check
 * can re-derive.
 */
import { createApackNativePlugin, type ApackNativePluginConfig } from './program.ts';
import type { ClaudeHookRegistrar } from './claude-plugin-api.ts';

declare const APACK_NATIVE_CONFIG: ApackNativePluginConfig;

export function register(on: ClaudeHookRegistrar): void {
  createApackNativePlugin(APACK_NATIVE_CONFIG).register(on);
}
