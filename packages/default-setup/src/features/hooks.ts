import { terminalService } from './code/be/services/terminal.ts';
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
  // Fire-and-forget, because this hook is synchronous and the API runs it inside `process.on('exit')`, where
  // no socket write completes. It is the orderly path; the broker ending a connection's sessions when the
  // connection goes is the backstop for an app that quit, crashed or was killed.
  void terminalService.killAll();
  clearAllSchedules();
  removeAllAdHocListeners();
  clearFlowActorRegistry();
};
