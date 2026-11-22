// An install asked for from outside the app: `apack://install?pack=<slug>&sourceKind=<kind>`, which the platform hands
// the window as parameters. Reading them and asking the Packs system is the app's, so a window only subscribes to
// the protocol and passes on what it was given.
import { tell } from '../../../events.ts';

export interface PackInstallRequest {
  packSlug: string;
  sourceKind?: string;
  sha256?: string;
}

/** The install a deep link's parameters ask for, or null when they name no pack */
export function packInstallRequest(params: Record<string, string>): PackInstallRequest | null {
  const packSlug = params.pack;
  if (!packSlug) {
    console.warn('[pack-install] Missing pack parameter in install URL');
    return null;
  }
  if (params.sha256 !== undefined && !/^[a-f\d]{64}$/i.test(params.sha256)) {
    console.warn('[pack-install] Invalid sha256 parameter in install URL');
    return null;
  }
  return { packSlug, sourceKind: params.sourceKind, ...(params.sha256 !== undefined ? { sha256: params.sha256.toLowerCase() } : {}) };
}

/** Asks the Packs system to install a pack; a send that fails is reported by the window's client */
export function requestPackInstall(request: PackInstallRequest): void {
  tell('packs', { type: 'INSTALL_PACK', ...request });
}

/** What a deep link asks for, installed: the one call a window makes when the platform hands it an install URL */
export function installFromProtocol(params: Record<string, string>): void {
  const request = packInstallRequest(params);
  if (request) requestPackInstall(request);
}
