import { FEATURE_ID_PATTERN } from '../ids/refs.ts';
import { _settingsJsonProblems } from './settings-json.ts';

/** Compiled endpoint metadata; shared SDK lifecycle events are implicit in the protocol. */
export interface FeatureEventContract {
  /**
   * Declared system inputs and outputs; private child events are excluded. `asks` names each declared ask with the
   * failure kinds its contract gives it, so the bus can tell an ask from an event and answer one nothing took.
   */
  system?: { incoming: readonly string[]; outgoing: readonly string[]; asks?: Readonly<Record<string, readonly string[]>> };
  /** Own-system outputs and declared inbox audiences, excluding shared SDK lifecycle events. */
  surface?: { receives: readonly string[] };
}

/** Local feature IDs mapped to their compiled transport contracts. */
export type PackEventContracts = Record<string, FeatureEventContract>;

function assertPlainRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function parseEventNames(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of event names`);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) throw new Error(`${label} must contain nonempty strings`);
    if (seen.has(item)) throw new Error(`${label}: Event names must be unique`);
    seen.add(item);
    names.push(item);
  }
  return names;
}

/** @internal Parse and validate compiled event contract structure without feature-ownership checks. */
export function _parseEventContractsShape(data: unknown): PackEventContracts {
  const jsonProblems = _settingsJsonProblems(data);
  if (jsonProblems.length) {
    throw new Error(`Invalid event contracts: ${jsonProblems.map(problem => `${problem.path.join('.') || 'root'}: event contracts must contain finite, acyclic JSON data properties`).join('; ')}`);
  }
  const root = assertPlainRecord(data, 'Event contracts');
  const contractEntries: Array<[string, FeatureEventContract]> = [];
  for (const [featureId, rawContract] of Object.entries(root)) {
    if (!FEATURE_ID_PATTERN.test(featureId)) throw new Error(`Invalid event contract feature id "${featureId}"`);
    const entry = assertPlainRecord(rawContract, `Event contract "${featureId}"`);
    for (const key of Object.keys(entry)) {
      if (key !== 'system' && key !== 'surface') throw new Error(`Event contract "${featureId}" contains unknown field "${key}"`);
    }
    const parsed: FeatureEventContract = {};
    if (Object.hasOwn(entry, 'system')) {
      const sys = assertPlainRecord(entry.system, `Event contract "${featureId}.system"`);
      for (const key of Object.keys(sys)) {
        if (key !== 'incoming' && key !== 'outgoing' && key !== 'asks') {
          throw new Error(`Event contract "${featureId}.system" contains unknown field "${key}"`);
        }
      }
      const incoming = parseEventNames(Object.hasOwn(sys, 'incoming') ? sys.incoming : undefined, `Event contract "${featureId}.system.incoming"`);
      const outgoing = parseEventNames(Object.hasOwn(sys, 'outgoing') ? sys.outgoing : undefined, `Event contract "${featureId}.system.outgoing"`);
      let asks: Record<string, string[]> | undefined;
      if (Object.hasOwn(sys, 'asks')) {
        const rawAsks = assertPlainRecord(sys.asks, `Event contract "${featureId}.system.asks"`);
        const askEntries: Array<[string, string[]]> = [];
        for (const [askName, rawFailures] of Object.entries(rawAsks)) {
          if (askName.length === 0) throw new Error(`Event contract "${featureId}.system.asks" contains an empty ask name`);
          if (!incoming.includes(askName)) throw new Error(`Event contract "${featureId}.system": Every ask must be among the incoming events`);
          askEntries.push([askName, parseEventNames(rawFailures, `Event contract "${featureId}.system.asks.${askName}"`)]);
        }
        asks = Object.fromEntries(askEntries);
      }
      parsed.system = asks !== undefined ? { incoming, outgoing, asks } : { incoming, outgoing };
    }
    if (Object.hasOwn(entry, 'surface')) {
      const surf = assertPlainRecord(entry.surface, `Event contract "${featureId}.surface"`);
      for (const key of Object.keys(surf)) {
        if (key !== 'receives') throw new Error(`Event contract "${featureId}.surface" contains unknown field "${key}"`);
      }
      parsed.surface = { receives: parseEventNames(Object.hasOwn(surf, 'receives') ? surf.receives : undefined, `Event contract "${featureId}.surface.receives"`) };
    }
    contractEntries.push([featureId, parsed]);
  }
  return Object.fromEntries(contractEntries);
}

/** @internal Read compiled authoring data with the same grammar and ownership checks as snapshots. */
export function _parseEventContracts(data: unknown, features: Parameters<typeof _eventContractsProblem>[1], native = false): PackEventContracts {
  const contracts = _parseEventContractsShape(data);
  const problem = _eventContractsProblem(contracts, features, native);
  if (problem) throw new Error(problem);
  return contracts;
}

/** @internal Validate endpoint ownership without importing the declaring modules. */
export function _eventContractsProblem(contracts: PackEventContracts | undefined,
  features: Readonly<Record<string, { system?: unknown; surface?: unknown }>> | undefined,
  native = false): string | undefined {
  for (const [id, contract] of Object.entries(contracts ?? {})) {
    if (!features || !Object.hasOwn(features, id)) return `Event contract belongs to undeclared feature "${id}"`;
    if (!contract.system && !contract.surface) return `Event contract "${id}" declares no endpoint`;
  }
  if (!native) for (const [id, feature] of Object.entries(features ?? {})) {
    for (const kind of ['system', 'surface'] as const) {
      const declared = feature[kind] !== undefined;
      const compiled = contracts?.[id]?.[kind] !== undefined;
      if (declared !== compiled) return `${declared ? 'Missing compiled' : 'Undeclared'} event contract for feature "${id}" ${kind}`;
    }
  }
}
