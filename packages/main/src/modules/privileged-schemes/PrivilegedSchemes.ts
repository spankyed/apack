import { protocol, type CustomScheme } from 'electron';
import type { AppModule } from '../../AppModule.ts';

/**
 * Every custom scheme's privileges, in the one list Electron is given. `registerSchemesAsPrivileged` keeps only its last
 * call, so a second caller silently takes every other scheme's privileges away: `check:specifiers`
 * (`findSchemeRegistrations`) refuses one anywhere else, and `tests/e2e/smoke/protocol-schemes.spec.ts` holds what these
 * grant in a real window.
 *
 * A scheme gets only what something here needs. `local-file` isn't listed because a video element needs nothing.
 */
const PRIVILEGED_SCHEMES: CustomScheme[] = [
  {
    scheme: 'media',
    privileges: {
      // Copying an image reads its URL with `fetch`, from another origin, so the handler answers with CORS headers
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
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
      standard: true,
      secure: true,
      supportFetchAPI: true,
      // Chromium checks CORS on a fetch-API scheme, and a pack's frontend is a module script the window
      // imports from another origin, so the handler's response says that window may read it
      corsEnabled: true,
    },
  },
];

class PrivilegedSchemes implements AppModule {
  enable(): void {
    protocol.registerSchemesAsPrivileged(PRIVILEGED_SCHEMES);
  }
}

export function createPrivilegedSchemes() {
  return new PrivilegedSchemes();
}
