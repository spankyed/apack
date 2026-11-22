import 'dotenv/config';
import { installFatalErrorHandling, writeFatalError } from './boot/errors';
import { captureApiToken } from './boot/config';
import { setupBackend } from './runtime';
import { createWebSocketServer } from './transport/websocket';

installFatalErrorHandling();
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

  try {
    createWebSocketServer();
  } catch (error) {
    writeFatalError(error, 'createWebSocketServer');
    process.exit(1);
  }
})();
