import { app, protocol } from 'electron';
import * as path from 'path';
import type { AppModule } from '../../AppModule.ts';
import type { MainModuleScope } from '../../MainModuleScope.ts';
import { getAppEnvironment } from '../../app-environment.ts';
import { readPackAsset } from '@apackdev/host/packs/assets';

/** Revision in the URL base also qualifies relative chunks, styles and their assets. */
export function packRequestTarget(requestUrl: string): { packId: string; buildRevision: string; filePath: string } | null {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'pack:' || !/^[a-z][a-z0-9-]*$/.test(url.hostname)
      || url.username || url.password || url.port) return null;
    const match = /^\/builds\/([a-f0-9]{64})\/(.+)$/.exec(decodeURIComponent(url.pathname));
    return match ? { packId: url.hostname, buildRevision: match[1], filePath: match[2] } : null;
  } catch { return null; }
}

/** Installed assets have one owner/root and must match the build the caller accepted. */
export function readPackFile({ packsDir, packId, buildRevision, filePath }: {
  packsDir: string; packId: string; buildRevision: string; filePath: string;
}): Buffer {
  if (!/^[a-z][a-z0-9-]*$/.test(packId)) throw new Error('Invalid pack id');
  return readPackAsset(path.join(packsDir, packId), packId, buildRevision, filePath);
}

export const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  // **`application/wasm` is a requirement, not a nicety.** `WebAssembly.instantiateStreaming` refuses a
  // response with any other type and the fallback is reading the whole module into an `ArrayBuffer` first,
  // which works and is slower. Without this a `.wasm` served from a pack falls to
  // `application/octet-stream` below and the streaming path cannot be used at all.
  '.wasm': 'application/wasm',
};


class PackProtocol implements AppModule {
  enable(_ctx: MainModuleScope): void {
    app.whenReady().then(() => {
      protocol.handle('pack', async (request) => {
        const target = packRequestTarget(request.url);
        if (!target) return new Response('Forbidden', { status: 403 });
        try {
          const bytes = readPackFile({ packsDir: getAppEnvironment().packsDir, ...target });
          const contentType = MIME_TYPES[path.extname(target.filePath)] || 'application/octet-stream';
          // Granted to whichever origin asked: only the app's windows reach this handler, its default session's
          // (`file://`, which a request names "null", or the dev server's). The in-app browser has its own session
          const origin = request.headers.get('Origin');
          return new Response(new Uint8Array(bytes), {
            headers: { 'Content-Type': contentType, ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}) },
          });
        } catch (error) {
          return new Response(error instanceof Error ? error.message : String(error), { status: 409 });
        }
      });
    });
  }
}

export function createPackProtocol() {
  return new PackProtocol();
}
