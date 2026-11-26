import './boot/env';
import { installFatalErrorHandling, writeFatalError } from './boot/errors';
import { captureApiToken } from './boot/config';
import { installShutdownBridge, isShutdownRequested } from './boot/lifecycle';
import { appClock, appDatabase, appPacks, appRunHistory, setupBackend } from './runtime';
import { startHostTransport, type HostTransport } from './transport/tool-server';
import { createWebSocketServer } from './transport/websocket';

installFatalErrorHandling();
installShutdownBridge();
// Before the app exists, and so before any pack can spawn a process that would inherit the token
captureApiToken();

function closeRuntimeSync(): void {
  appPacks?.runShutdownHooks();
  try { appDatabase?.close(); } catch {}
  try { appRunHistory?.database.close(); } catch {}
  try { appClock?.close(); } catch {}
}

// Initialize backend systems, then start host transport (api-runtime.json + optional tool socket) and WebSocket server
(async () => {
  try {
    await setupBackend();
  } catch (error) {
    writeFatalError(error, 'setupBackend');
    process.exit(1);
  }

  // A quit or dev reload arrived while `setupBackend()` was running: tear down cleanly without binding a port.
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

  try {
    createWebSocketServer({
      toolSocket: hostTransport.socket,
      onShutdown: () => hostTransport[Symbol.dispose](),
    });
  } catch (error) {
    await hostTransport.close();
    writeFatalError(error, 'createWebSocketServer');
    closeRuntimeSync();
    process.exit(1);
  }
})();
