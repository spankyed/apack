import { clearAllSchedules } from './brain/be/services/scheduler.ts';
import { removeAllListeners as removeAllAdHocListeners } from './brain/be/services/brain.ts';
import { clearFlowActorRegistry } from './brain/be/flow-system.ts';
import { services } from '#generated/services.ts';
import { startTerminalSizing } from './code/be/features/terminal.ts';

/** What the pack's backend follows for as long as it runs */
let stopTerminalSizing: (() => void) | undefined;

export const onInit = () => {
  // A terminal's grid is the smallest fit of the windows showing it, so it has to hear when one goes
  stopTerminalSizing = startTerminalSizing();
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
  stopTerminalSizing?.();
  stopTerminalSizing = undefined;
  clearAllSchedules();
  removeAllAdHocListeners();
  clearFlowActorRegistry();
};
