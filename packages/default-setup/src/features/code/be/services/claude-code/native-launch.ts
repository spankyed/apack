import {copyClaudeChannelSelection} from '../../../common/native-channels.ts'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { PermissionModeSchema } from './types.ts'
import type { ClaudeNativeLaunch } from '../../../common/native-launch.ts'

/** A saved descriptor cannot introduce settings, environment or print-only launch flags. */
export const ClaudeNativeLaunchSchema = z.object({
  sessionId: z.string().uuid(), cwd: z.string().refine(isAbsolute),
  model: z.string().min(1).optional(), permissionMode: PermissionModeSchema.optional(), prePlanMode: PermissionModeSchema.exclude(['plan']).optional(),
  allowedTools: z.array(z.string()).optional(), disallowedTools: z.array(z.string()).optional(),
  appendSystemPrompt: z.string().optional(), addDir: z.array(z.string()).optional(), pluginDir: z.array(z.string()).optional(), channels: z.array(z.string().min(1)).optional(),
}).strict() satisfies z.ZodType<ClaudeNativeLaunch>

export function snapshotClaudeNativeLaunch(value: ClaudeNativeLaunch): ClaudeNativeLaunch {
  const {sessionId,cwd,model,permissionMode,prePlanMode,allowedTools,disallowedTools,appendSystemPrompt,addDir,pluginDir,channels}=value
  return {sessionId,cwd,model,permissionMode,...(permissionMode === 'plan' && prePlanMode ? {prePlanMode} : {}),allowedTools:allowedTools?.slice(),disallowedTools:disallowedTools?.slice(),appendSystemPrompt,addDir:addDir?.slice(),pluginDir:pluginDir?.slice(),channels:channels?.slice()}
}

export function readClaudePlanRestoreMode(state: Record<string, unknown> | undefined): import('./types.ts').PermissionMode | undefined {
  return state?.permissionMode === 'plan' ? PermissionModeSchema.exclude(['plan']).optional().parse(state.prePlanMode) : undefined
}

/** Current thread choices supersede the last process's launch intent. */
export function readSavedClaudeNativeLaunch(state: Record<string, unknown> | undefined): ClaudeNativeLaunch | undefined {
  if (!state?.nativeLaunch) return
  const launch = ClaudeNativeLaunchSchema.parse(state.nativeLaunch)
  if (launch.sessionId !== state.sessionId || launch.cwd !== state.cwd) throw new Error('Saved native launch no longer matches this session')
  const model = state.modelOverride === undefined ? launch.model : state.modelOverride === 'default' ? undefined : z.string().min(1).parse(state.modelOverride)
  const permissionMode = state.permissionMode === undefined ? launch.permissionMode : PermissionModeSchema.parse(state.permissionMode)
  const staged = state.additionalDirs === undefined ? undefined : z.array(z.string().min(1)).parse(state.additionalDirs)
  const addDir = staged === undefined ? launch.addDir : [...new Set([...(launch.addDir ?? []), ...staged])]
  const channels=state.channelSelection===undefined?launch.channels:copyClaudeChannelSelection(state.channelSelection)
  return {...launch,channels,model,permissionMode,prePlanMode: permissionMode === 'plan' ? readClaudePlanRestoreMode(state) : undefined,...(addDir === undefined ? {} : {addDir})}
}
