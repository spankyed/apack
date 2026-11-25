import './boot/env';
import { installFatalErrorHandling, writeFatalError } from './boot/errors';
import { captureApiToken } from './boot/config';
import { installShutdownBridge, isShutdownRequested } from './boot/lifecycle';
import { appDatabase, appPacks, appRunHistory, setupBackend } from './runtime';
import { createWebSocketServer } from './transport/websocket';

installFatalErrorHandling();
installShutdownBridge();
// Before the app exists, and so before any pack can spawn a process that would inherit the token
captureApiToken();

// Initialize backend systems, then start WebSocket server
(async () => {
  try {
    await setupBackend();
  } catch (error) {
    writeFatalError(error, 'setupBackend');
    process.exit(1);
  }

  // A quit or dev reload arrived while `setupBackend()` was running: tear down cleanly without binding a port.
  if (isShutdownRequested()) {
    appPacks?.runShutdownHooks();
    try { appDatabase?.close(); } catch {}
    try { appRunHistory?.database.close(); } catch {}
    process.exit(0);
  }

  try {
    createWebSocketServer();
  } catch (error) {
    writeFatalError(error, 'createWebSocketServer');
    process.exit(1);
  }
})();
