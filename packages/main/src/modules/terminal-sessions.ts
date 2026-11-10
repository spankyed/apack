import {ipcMain} from 'electron';
import {holdTerminalSessions, terminalViewEndpoint} from '@apackdev/host/services';
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
 * **The `will-quit` release below is an ordering, not the guarantee.** The kernel is still what makes the
 * shells die, and a run where this handler never fires loses nothing. What it buys is that a clean quit ends
 * them at a known point instead of whenever the process is reaped, and that the hold is releasable at all
 * rather than a one-way door. `will-quit` and not `before-quit`: the API server cancels termination in
 * `before-quit` until its process has stopped, so releasing there would end every session while the API was
 * still running and have it broadcast a crash to windows that are already closing.
 *
 * **Registered before the API server**, so the hold exists before anything can ask for a session.
 *
 * **A failure here is logged and nothing else.** The broker binary is absent in a checkout that has not
 * staged it into its package, and refusing to start the app over a terminal would be wildly out of
 * proportion. What is lost is persistence across an API restart, not safety: with no owner the broker ends its sessions when the
 * last client leaves, which is what it has always done and is why getting this wrong cannot leave a shell
 * running after the app is gone.
 */
export function holdTerminalSessionsForTheApp(): AppModule {
  return {
    async enable({app}) {
      // **Where a window finds the broker, and what it says to it first.** A window draws its terminals
      // from the broker directly, so it has to be told the socket; it is told the greeting too, so the
      // one place that knows the protocol's version stays the host. Asked as the window opens a
      // connection rather than given at its creation: the broker may not have been listening then.
      ipcMain.on('terminal:view-endpoint', event => {
        try {
          event.returnValue = terminalViewEndpoint();
        } catch (error) {
          console.warn('[terminal] no broker for a window to draw from', error);
          event.returnValue = null;
        }
      });
      try {
        const held = await holdTerminalSessions();
        app.once('will-quit', () => {
          try {
            held.close();
          } catch (error) {
            // The socket may already be gone, which is the same outcome by another route
            console.warn('[terminal] the session hold would not close', error);
          }
        });
      } catch (error) {
        console.warn('[terminal] no session hold; a terminal will not survive an API restart', error);
      }
    },
  };
}
