import type { AppModule } from '../../AppModule.ts';
import type { MainModuleScope } from '../../MainModuleScope.ts';
import { protocol, net } from 'electron';
import { resolveMediaFilePath } from './paths.ts';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Says a window's `fetch` may read this response. Granted to whichever origin asked: only the app's windows reach this
 * handler, its default session's (`file://`, which a request names "null", or the dev server's). An image or video
 * element's request names no origin and gets the response as it is, seeking included.
 */
function readableBy(request: Request, response: Response): Response {
  const origin = request.headers.get('Origin');
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  return new Response(response.body, { status: response.status, headers });
}

class MediaProtocol implements AppModule {
  enable({ app }: MainModuleScope): void {
    app.whenReady().then(() => {
      protocol.handle('media', async (request) => {
        const url = new URL(request.url);
        const entityId = url.hostname;
        const filename = decodeURIComponent(url.pathname.slice(1)); // strip leading /

        if (!entityId || !filename || entityId.includes('..') || filename.includes('..')) {
          return readableBy(request, new Response('Not found', { status: 404 }));
        }

        const filePath = resolveMediaFilePath(entityId, filename);

        if (!existsSync(filePath)) {
          return readableBy(request, new Response('Not found', { status: 404 }));
        }

        return readableBy(request, await net.fetch(pathToFileURL(filePath).toString()));
      });

      // Serve local files to the renderer (used for video playback in editor tabs).
      // Uses registerFileProtocol (deprecated but functional), which serves buffered file responses a video element
      // can seek in, and needs no scheme privileges.
      protocol.registerFileProtocol('local-file', (request, callback) => {
        const url = new URL(request.url);
        const filePath = url.searchParams.get('path');

        if (!filePath || !existsSync(filePath)) {
          callback({ error: -6 }); // net::ERR_FILE_NOT_FOUND
          return;
        }

        callback(filePath);
      });
    });
  }
}

export function createMediaProtocol() {
  return new MediaProtocol();
}
