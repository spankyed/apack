import {claudeTerminalHelperPolicyRuntime} from './terminal-helper-policy-runtime.ts'
import { withClaudeNativePlatformRuntime } from './native-platform-runtime.ts'
/** Read effective native policy without duplicating its discovery or precedence. */
export const claudeTerminalHelperPolicyReaderRuntime = String.raw`let helperPolicyReader,helperCommandReader,helperPolicyPreparation;
export function readNativeHelperPolicy(){return helperPolicyReader?.()}
export function readNativeHelperCommands(){return helperCommandReader?.()}
export function prepareNativeHelperPolicy(){
 return helperPolicyPreparation??=(async()=>{
  const settings=await import('/$bunfs/root/chunk-1pjd7qsk.js');
  helperPolicyReader=()=>{const effective=settings.ut(),policy=settings.me('policySettings')??{};return JSON.stringify([policy.allowManagedHooksOnly===true,policy.disableAllHooks===true,effective.disableAllHooks===true])};
  helperCommandReader=()=>{const snapshot=nativeHelperPolicySnapshot(settings.ut(),settings.me('policySettings')??{});return{main:snapshot.statusCommand,subagent:snapshot.subagentCommand,prefix:process.env.CLAUDE_CODE_SHELL_PREFIX}};
 })();
}
`

/** Standalone spare preload retains the same exact-binary admission as the terminal adapter. */
export const claudeTerminalHelperPolicyReaderModule = withClaudeNativePlatformRuntime(String.raw`import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
if(createHash('sha256').update(readFileSync(process.execPath)).digest('hex')!=='5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37')throw Error('Native UI transport requires the reviewed Claude Code 2.1.302 binary');
${claudeTerminalHelperPolicyRuntime}
${claudeTerminalHelperPolicyReaderRuntime}`, 'terminal')
