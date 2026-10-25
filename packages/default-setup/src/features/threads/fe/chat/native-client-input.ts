import type { InjectionKey, ComputedRef } from 'vue'
import type { ClaudeUiClientInput } from '#features/code/be/services/claude-code/ui-controls.ts'
/** A mounted view supplies the port; native modules and handles stay in their process. */
export const claudeClientInput: InjectionKey<(id:string,event:ClaudeUiClientInput)=>void> = Symbol('claude-client-input')

/** Terminal-only drawings return keyboard ownership to the mounted composer. */
export const claudeClientReturnFocus: InjectionKey<() => void> = Symbol('claude-client-return-focus')

/** Visibility of the app-owned host; hiding it does not release native sandbox holders. */
export const claudeClientVisible: InjectionKey<ComputedRef<boolean>> = Symbol('claude-client-visible')
