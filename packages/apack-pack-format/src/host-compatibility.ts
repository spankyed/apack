import { parse, satisfies } from 'semver';

/**
 * Whether an app at `appVersion` satisfies a pack's `hostVersion` range.
 *
 * A prerelease counts as its release, the same rule the migrations runner states: `0.4.0-beta.2` runs
 * the `0.4.0` migrations, and here it installs the packs that ask for `>=0.4.0`. Semver orders a
 * prerelease *before* its release, so without this a beta refuses every pack that requires the release
 * it is a beta of — which is the release those packs are being tested against. The trade is the same
 * one migrations already take: a pack asking for `>=0.4.0` installs on an early beta that may not have
 * everything it needs yet.
 */
export function isHostCompatible(hostRange: string | undefined, appVersion: string): boolean {
  if (!hostRange) return true;
  try {
    const parsed = parse(appVersion);
    const asRelease = parsed && parsed.prerelease.length > 0 ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : appVersion;
    return satisfies(asRelease, hostRange, { includePrerelease: true });
  } catch {
    return false;
  }
}
