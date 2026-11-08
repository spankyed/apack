import { clearAllSchedules } from './brain/be/services/scheduler.ts';
import { removeAllListeners as removeAllAdHocListeners } from './brain/be/services/brain.ts';
import { clearFlowActorRegistry } from './brain/be/flow-system.ts';
import { services } from '#generated/services.ts';

export const onInit = () => {};

/**
 * The pack's backend stopped (the app exiting or unloading the pack, a test app stopping): its stopped actors never
 * reach the brain's kill, so drop what outlives them here, or cron jobs keep sending the brain events. The runs they
 * leave unfinished are marked stopped in the run history, as a kill marks them
 */
export const onShutdown = () => {
  services.runHistory.stopActive();
  // **This used to kill every terminal, and killing them here is now exactly wrong.** A session outlives
  // this process on purpose: restarting the API must not take a user's shells down, which is what the whole
  // lifetime rule is for. What ends them is the app's own hold on the broker closing, which a descriptor
  // does on process death however the process died — and with no owner, the broker's rule that the last
  // client leaving ends them, which is what keeps a dev run or a test from leaving anything behind.
  // Terminals are still ended deliberately: `cleanupTerminals` is the user asking for it.
  clearAllSchedules();
  removeAllAdHocListeners();
  clearFlowActorRegistry();
};
