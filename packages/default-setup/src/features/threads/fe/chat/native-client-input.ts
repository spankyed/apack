import type { InjectionKey } from 'vue'
import type { ClaudeUiClientInput } from '#features/code/be/services/claude-code/ui-controls.ts'
/** A mounted view supplies the port; native modules and handles stay in their process. */
export const claudeClientInput: InjectionKey<(id:string,event:ClaudeUiClientInput)=>void> = Symbol('claude-client-input')
