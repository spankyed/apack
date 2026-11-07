import { type Ref } from 'vue'
import type { ActorRefFrom } from 'xstate'
import type { TerminalInfo } from '../features/terminal/state.ts'
import type { terminalState } from '../features/terminal/state.ts'

type TerminalActor = ActorRefFrom<typeof terminalState>

export interface TerminalCloseOptions {
  /**
   * If true, skips the confirmation dialog even if confirmTerminalClose is enabled.
   * Useful for programmatic closes where confirmation was already handled.
   */
  skipConfirmation?: boolean
}

/**
 * Composable for terminal operations with centralized logic.
 * Handles confirmation dialogs and terminal process management according to settings.
 */
export function useTerminalActions(
  terminalActor: TerminalActor | undefined,
  confirmTerminalClose: Ref<boolean>,
  closeTerminalOnTabClose: Ref<boolean>
) {
  /**
   * What a terminal is called: the name the user gave it, else the one the terminal has.
   *
   * It used to derive the cwd's basename here and fall back to `title` only if that was empty, which threw
   * away the title in every case that matters. The backend already derives a title from the cwd (and keeps
   * it current as the cwd moves, unless there is a `customTitle`), so this was a second copy of that rule
   * overriding the first — and it overrode a title that was deliberate, such as the one a create passed.
   */
  const getTerminalDisplayName = (terminalInfo: TerminalInfo): string =>
    terminalInfo.customTitle || terminalInfo.title

  /**
   * Closes a terminal with proper confirmation and settings handling.
   *
   * @param terminalInfo - The terminal to close
   * @param options - Optional configuration
   * @returns true if terminal was closed, false if cancelled
   */
  const closeTerminal = (
    terminalInfo: TerminalInfo,
    options: TerminalCloseOptions = {}
  ): boolean => {
    const { skipConfirmation = false } = options

    // Show confirmation dialog if setting is enabled and not skipped
    if (!skipConfirmation && confirmTerminalClose.value) {
      const displayName = getTerminalDisplayName(terminalInfo)
      if (!confirm(`Close terminal "${displayName}"?`)) {
        return false // User cancelled
      }
    }

    // Only send close event if setting is enabled
    if (closeTerminalOnTabClose.value) {
      terminalActor?.send({ type: 'terminal.CLOSE', terminalId: terminalInfo.id })
    }

    return true // Terminal was closed (or will be closed)
  }

  return {
    closeTerminal,
    getTerminalDisplayName
  }
}
