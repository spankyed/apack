import { clearClaudeUiViews } from './threads/be/claude-ui.ts';
import { killAllHandles } from './code/be/services/claude-code/handle-store.ts';
import { clearAllSchedules } from './brain/be/services/scheduler.ts';
import { removeAllListeners as removeAllAdHocListeners } from './brain/be/services/brain.ts';
import { clearFlowActorRegistry } from './brain/be/flow-system.ts';
import { services } from '#generated/services.ts';
import { startTerminalSizing } from './code/be/features/terminal.ts';

/** What the pack's backend follows for as long as it runs */
let stopTerminalSizing: (() => void) | undefined;

/**
 * The pack's backend started.
 *
 * **A turn's text can be left unfolded, and only a boot can know it was.** A streamed reply's growth is
 * appended to child rows and folded into `Message.text` — the field the text index reads — when its writer
 * finalises. A turn's owner releases its writers on every exit from the stream, so a kill folds; what
 * cannot is the process ending mid-turn, where there is no exit to pass through.
 *
 * Nothing streams at boot, so a message still holding text segments here was left that way, which is the
 * marker and why this needs no `'streaming'` status to find them by. Without it that tail stays out of the
 * index for good.
 */
export const onInit = () => {
  // A terminal's grid is the smallest fit of the windows showing it, so it has to hear when one goes
  stopTerminalSizing = startTerminalSizing();
  const folded = services.repository.chatCommands.foldStrandedMessageText();
  if (folded > 0) services.logger.info('folded the text of messages a turn left unfinished', { messages: folded });
};

/**
 * The pack's backend stopped (the app exiting or unloading the pack, a test app stopping): its stopped actors never
 * reach the brain's kill, so drop what outlives them here, or cron jobs keep sending the brain events. The runs they
 * leave unfinished are marked stopped in the run history, as a kill marks them
 */
export const onShutdown = () => {
  services.runHistory.stopActive();
  // **Nothing here ends a terminal, and nothing in this process may.** A session outlives the API on
  // purpose: restarting it must not take a user's shells down, which is the whole of the lifetime rule.
  // What ends them is the app's own hold on the broker closing — a descriptor closes on process death
  // however the process died — and, with no owner holding it, the broker's own rule that the last client
  // leaving ends them, which is what keeps a dev run or a test from leaving a shell behind. The only
  // deliberate end is the user closing a terminal, which is `terminalService.kill`.
  // What does end here is this process's own follow of the windows, which is not a session.
  stopTerminalSizing?.();
  stopTerminalSizing = undefined;
  //
  // The Claude Code integration's own children are a different matter: a handle is this process's, so a
  // handle left running is leaked rather than persisted, and the views it fed have nobody to reach.
  clearClaudeUiViews();
  killAllHandles();
  clearAllSchedules();
  removeAllAdHocListeners();
  clearFlowActorRegistry();
};
