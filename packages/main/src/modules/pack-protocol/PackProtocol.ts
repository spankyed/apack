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
};


class PackProtocol implements AppModule {
  enable(_ctx: MainModuleScope): void {
    protocol.registerSchemesAsPrivileged([
      {
        scheme: 'pack',
        privileges: {
          // **A real origin per pack**, which is the whole of what this buys. Measured in Electron 37,
          // 2026-10-08: with it, `new URL('pack://p/x').origin` is `pack://p`; without it, `"null"`.
          // Everything a module needs is identical either way — relative specifiers inside a `pack://`
          // module, bare ones through the document's import map, dot-segment normalisation, `fetch`,
          // `import.meta.url` — so nothing about loading a pack's bundle rests on this, and a claim that
          // something does can be checked by taking the flag off and watching it still pass.
          //
          // The origin is latent today: only modules are loaded at `pack://`, never a document, so nothing
          // partitions storage or consults it. It becomes load-bearing the day a pack's UI runs in its own
          // document (`docs/plans/pack-fault-isolation.md`).
          //
          // **The one behaviour it does change is the host's case**: a standard scheme lowercases it, so
          // `pack://My-Pack/x` reaches the `my-pack` pack rather than being refused. That is what http does
          // with hosts, and `PACK_ID` still refuses everything that is not a plain segment.
          // `local-file` in `../media-protocol/MediaProtocol.ts` already ships this combination.
          standard: true,
          secure: true,
          supportFetchAPI: true,
          // Chromium checks CORS on a fetch-API scheme, and a pack's frontend is a module script the window
          // imports from another origin, so the response below says that window may read it
          corsEnabled: true,
        },
      },
    ]);

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
