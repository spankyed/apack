import {holdTerminalSessions} from '@apackdev/host/services';
import {shippedPacksDir} from '../app-environment.ts';
import type {AppModule} from '../AppModule.ts';

/**
 * Holds every terminal session open for as long as the app is running, and ends them when it stops.
 *
 * **This process and no other, because it is the only one whose lifetime is the app's.** A session has to
 * outlive the API — restarting the API must not take a user's shells down — so whatever guarantees the
 * shells die with the app cannot be the API. It is a held connection rather than a `will-quit` handler on
 * purpose: a descriptor closes on process death however the process died, so a crash or a kill reaps the
 * shells exactly as a clean quit does, and there is no path that has to remember to.
 *
 * **Registered before the API server**, so the hold exists before anything can ask for a session.
 *
 * **A failure here is logged and nothing else.** The broker binary is absent in a checkout that has not
 * built it, and refusing to start the app over a terminal would be wildly out of proportion. What is lost
 * is persistence across an API restart, not safety: with no owner the broker ends its sessions when the
 * last client leaves, which is what it has always done and is why getting this wrong cannot leave a shell
 * running after the app is gone.
 */
export function holdTerminalSessionsForTheApp(): AppModule {
  return {
    async enable() {
      try {
        await holdTerminalSessions({packagesDir: shippedPacksDir()});
      } catch (error) {
        console.warn('[terminal] no session hold; a terminal will not survive an API restart', error);
      }
    },
  };
}
