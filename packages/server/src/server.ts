import './boot/env';
import { installFatalErrorHandling, writeFatalError } from './boot/errors';
import {
  installShutdownBridge,
  isShutdownRequested,
  notifyServerReady,
  registerGracefulShutdown,
} from './boot/lifecycle';
import { appClock, appDatabase, appPacks, appRunHistory, backendActor, setupBackend } from './runtime';
import { startHostTransport, type HostTransport } from './transport/tool-server';

installFatalErrorHandling();
installShutdownBridge();

function closeRuntimeSync(): void {
  appPacks?.runShutdownHooks();
  try {
    appDatabase?.close();
  } catch (error) {
    console.error('[backend] Closing the database failed', error);
  }
  try {
    appRunHistory?.database.close();
  } catch (error) {
    console.error('[backend] Closing the run history failed', error);
  }
  try {
    appClock?.close();
  } catch {}
}

// Initialize backend systems, then start host transport (`api-runtime.json`, Electron window ports, and optional local tool socket)
(async () => {
  try {
    await setupBackend();
  } catch (error) {
    writeFatalError(error, 'setupBackend');
    process.exit(1);
  }

  // A quit or dev reload arrived while `setupBackend()` was running: tear down cleanly without publishing transport.
  if (isShutdownRequested()) {
    closeRuntimeSync();
    process.exit(0);
  }

  let hostTransport: HostTransport;
  try {
    hostTransport = await startHostTransport();
  } catch (error) {
    writeFatalError(error, 'startHostTransport');
    closeRuntimeSync();
    process.exit(1);
  }

  if (isShutdownRequested()) {
    await hostTransport.close();
    closeRuntimeSync();
    process.exit(0);
  }

  process.on('exit', () => {
    try {
      hostTransport[Symbol.dispose]();
    } catch {}
    closeRuntimeSync();
  });

  registerGracefulShutdown(() => {
    try {
      hostTransport[Symbol.dispose]();
    } catch {}
    backendActor?.stop();
    // Exit explicitly so the 'exit' handler fires before Electron force-kills us
    process.exit(0);
  });

  console.log(
    hostTransport.socket
      ? `✅ API Server ready (tool socket: ${hostTransport.socket})`
      : '✅ API Server ready',
  );
  notifyServerReady(hostTransport.socket);
})();
