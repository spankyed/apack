// Says the person is looking at a terminal for as long as a component showing it is mounted: when something
// its programs finished or failed at arrives while the window has the focus, and when the window gets it.
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useState } from '@apackdev/sdk/fe'
import type { TerminalActor } from './state.ts'
import { needsLooking } from './status.ts'

/**
 * `terminalId` is the terminal the calling component shows, which for the panel changes.
 *
 * **Being shown is not being looked at.** A terminal on screen in a window behind another is not seen, so
 * what arrives then waits until the window is in front; and a pointer or a mount, which the components
 * already report, are not the only ways someone comes to be looking.
 */
export function useStatusSeen(actor: TerminalActor, terminalId: () => string | undefined): void {
  const { state: terminal, send } = useState(actor)
  const unseen = computed(() => {
    const id = terminalId()
    return id !== undefined && needsLooking(terminal.value.data.terminals.find(terminal => terminal.id === id)?.statuses)
  })
  const look = () => {
    const id = terminalId()
    if (id !== undefined && unseen.value && document.hasFocus()) send({ type: 'terminal.SEEN', terminalId: id })
  }
  watch(unseen, look)
  onMounted(() => window.addEventListener('focus', look))
  onBeforeUnmount(() => window.removeEventListener('focus', look))
}
