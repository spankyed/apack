import { valid, validRange } from 'semver';

const numeric = '(?:0|[1-9][0-9]*)';
const prerelease = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
/** SemVer 2.0 grammar, without normalization of prefixes or whitespace. */
export const _PACK_VERSION_PATTERN = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$(?![\\s\\S])`);

export function _validPackVersion(value: string): boolean {
  return _PACK_VERSION_PATTERN.test(value) && valid(value) !== null;
}

export function _validPackRange(value: string): boolean {
  return value.trim().length > 0 && validRange(value) !== null;
}

/** Parsed authored source locator and the version range its resolver must enforce. */
export interface PackDependencySource {
  /** Explicit GitHub owner/repository, or null for local/installed resolution. */
  github: string | null;
  /** Explicit filesystem path relative to the consuming pack root, or null. */
  filePath: string | null;
  /** npm semver range; file sources use "*". */
  range: string;
}

/** Parse supported source syntax before any filesystem or network resolution. */
export function parsePackDependency(value: string): PackDependencySource {
  if (value.startsWith('file:')) {
    const filePath = value.slice(5).trim();
    if (!filePath) throw new Error('file: requires a dependency path');
    return { github: null, filePath, range: '*' };
  }
  if (value.startsWith('github:')) {
    const match = /^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\s+(.+))?$/.exec(value);
    if (!match || match[1]!.split('/').some(part => part === '.' || part === '..')) {
      throw new Error('github: requires owner/repo, optionally followed by a semver range');
    }
    const range = match[2]?.trim() ?? '*';
    if (!_validPackRange(range)) throw new Error(`Invalid dependency range "${range}"`);
    return { github: match[1]!, filePath: null, range };
  }
  if (!_validPackRange(value)) throw new Error(`Invalid dependency range "${value}"`);
  return { github: null, filePath: null, range: value };
}
