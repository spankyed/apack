import fs from 'node:fs';
import path from 'node:path';
import { hash as cryptoHash } from 'node:crypto';
import { verifyPack } from '../packs/assets.ts';
import type { PackIntegrity } from '../packs/layout-paths.ts';
import { readPackageInputs, type PackageInputOwner } from './package-inputs.ts';
import { assertNativeCompilerObservations, withoutCompilerFileReads, type CompilerInputObservations } from './compiler-inputs/index.ts';

/** Source-build metadata: sealed with its output, omitted from installed packs like phase-cache.json. */
export const PACK_BUILD_INPUTS_FILE = 'build-inputs.json';

export interface PackBuildInputs {
  readonly compiler: string;
  /** Digest of the actual initial execution context; never the ambient context of an inspecting command. */
  readonly execution: string;
  readonly options: readonly string[];
  readonly packages: {
    readonly hash: string;
    /** Directories and discovered package locations are relative to the authored pack root. */
    readonly owners: readonly PackageInputOwner[];
    readonly discovered: readonly string[];
  };
  readonly observations: CompilerInputObservations['entries'];
}

const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && !value.includes('\0');
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function parsePackBuildInputs(value: unknown): PackBuildInputs {
  if (!object(value) || !hash(value.compiler) || !hash(value.execution) || !strings(value.options)
    || !object(value.packages) || !hash(value.packages.hash) || !strings(value.packages.discovered)
    || !Array.isArray(value.packages.owners) || !value.packages.owners.length
    || !value.packages.owners.every(owner => object(owner) && text(owner.id) && text(owner.directory)
      && (owner.development === undefined || typeof owner.development === 'boolean')
      && (owner.contents === undefined || typeof owner.contents === 'boolean')
      && (owner.dependencyContents === undefined || owner.dependencyContents === 'all' || owner.dependencyContents === 'resolution'))
    || !Array.isArray(value.observations) || !value.observations.every(entry => Array.isArray(entry)
      && entry.length === 2 && entry.every(text))) {
    throw new Error('Invalid pack build inputs: expected compiler, execution, options, package scope and observations');
  }
  const queries = new Set<string>();
  for (const [query, result] of value.observations) {
    if (result !== 'undefined') JSON.parse(result);
    const decoded: unknown = JSON.parse(query);
    if (!Array.isArray(decoded) || !decoded.length || !text(decoded[0]) || queries.has(query)) {
      throw new Error('Invalid pack build inputs: malformed or repeated observation');
    }
    queries.add(query);
  }
  if (!queries.has('["authored-files"]')) throw new Error('Invalid pack build inputs: missing authored inventory');
  return value as unknown as PackBuildInputs;
}

/** Write only to the candidate before sealPackBuild; the existing file receipt binds inputs and output. */
export function writePackBuildInputs(directory: string, inputs: PackBuildInputs): string {
  const bytes = `${JSON.stringify(parsePackBuildInputs(inputs), null, 2)}\n`;
  fs.writeFileSync(path.join(directory, PACK_BUILD_INPUTS_FILE), bytes);
  return bytes;
}

/** A supplied receipt must already be verified by the caller; captured bytes must still match it. */
export function readPackBuildInputs(directory: string, integrity: PackIntegrity = verifyPack(directory)): PackBuildInputs {
  const bytes = fs.readFileSync(path.join(directory, PACK_BUILD_INPUTS_FILE));
  if (cryptoHash('sha256', bytes, 'hex') !== integrity.files[PACK_BUILD_INPUTS_FILE]) {
    throw new Error('Pack build inputs do not match the sealed output; rebuild the complete pack');
  }
  return parsePackBuildInputs(JSON.parse(bytes.toString('utf8')));
}

/** Compare source data in the recorded build context; a different command's environment is not that context. */
export function assertPackBuildInputsCurrent(root: string, inputs: PackBuildInputs): void {
  withoutCompilerFileReads(() => {
    parsePackBuildInputs(inputs);
    assertNativeCompilerObservations({ root: fs.realpathSync.native(root), entries: inputs.observations });
    const packages = readPackageInputs(inputs.packages.owners.map(owner => ({ ...owner,
      directory: path.resolve(root, owner.directory),
    })), { discovered: inputs.packages.discovered.map(directory => path.resolve(root, directory)), dependencyContents: 'resolution' });
    if (packages.hash !== inputs.packages.hash) throw new Error('Pack build package inputs changed; rebuild the complete pack');
  });
}
