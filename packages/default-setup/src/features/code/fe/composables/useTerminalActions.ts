import { type Ref } from 'vue'
import type { CodeTerminalEvent, TerminalInfo } from '../features/terminal/state.ts'

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
  sendTerminal: ((event: CodeTerminalEvent) => void) | undefined,
  confirmTerminalClose: Ref<boolean>,
  closeTerminalOnTabClose: Ref<boolean>
) {
  /**
   * What a terminal is called: the name the user gave it, else the one the terminal has.
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

    if (!skipConfirmation && confirmTerminalClose.value) {
      const displayName = getTerminalDisplayName(terminalInfo)
      if (!confirm(`Close terminal "${displayName}"?`)) {
        return false
      }
    }

    if (closeTerminalOnTabClose.value) {
      sendTerminal?.({ type: 'terminal.CLOSE', terminalId: terminalInfo.id })
    }

    return true
  }

  return {
    closeTerminal,
    getTerminalDisplayName
  }
}
