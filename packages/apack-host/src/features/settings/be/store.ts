import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createLogger } from '@apackdev/sdk/logger';
// One host writer composes declarations beneath explicit choices for every preference owner.
import type { Ears } from '@apackdev/ears';
import type { EARS } from '@apackdev/sdk';
import { _settingsJsonProblems, type SettingsCatalog } from '@apackdev/sdk/framework';
import { deepMerge, isPlainObject } from '@apackdev/sdk/utils/pure';
import { settingsTargetPath, type SettingsDocument, type SettingsOverrides, type SettingsTarget, type SettingsSnapshot, type SettingsRecovery, type SettingsRecoveryRequest, type SettingsWriteCondition } from '@apackdev/sdk/types';
import type { SettingsChange } from '@apackdev/sdk/services';
import { authorizeSettings, settingsDefinition } from '../authorization.ts';
import { getIn, isEqual, removeIn, SettingsRefusedError, setIn } from '../document.ts';
import { compileSettingsCatalog } from '../validation.ts';
export type { SettingsChange, SettingsDocument };

export const SETTINGS_ENTITY = 'Settings';
const SETTINGS_ID = `${SETTINGS_ENTITY}-app` as EARS.EntityId;
const logger = createLogger('settings');
export interface SettingsStoreOptions {
  /** The owning engine; test harnesses resolve the current engine after a reset. */
  ears: () => Pick<Ears, 'query' | 'upsert'>;
  catalog: () => SettingsCatalog;
  /** Omit only for a fixed catalog, such as a one-shot validator. */
  onCatalogChanged?: (listener: () => void) => () => void;
  /** Composition removes database maintenance authority before invoking subscribers. */
  observe?: <T>(operation: () => T) => T;
}
export type SettingsStore = ReturnType<typeof createSettingsStore>;

export function createSettingsStore({ ears, catalog, onCatalogChanged, observe = operation => operation() }: SettingsStoreOptions) {
  const listeners = new Set<(change: SettingsChange) => void>();
  let replacingData = 0;
  let replacementFailure: unknown;
  let recovering = false;
  const replacement = new AsyncLocalStorage<{ active: boolean }>();
  let replacementSnapshot: Pick<SettingsSnapshot, 'values' | 'catalog'> | undefined;
  const runId = randomUUID();
  let revision = 0;
  let atRevision = -1;
  let validation: ReturnType<typeof compileSettingsCatalog>;

  function declarations(): SettingsCatalog {
    const definitions = catalog();
    if (definitions.revision !== atRevision) {
      validation = compileSettingsCatalog(definitions);
      atRevision = definitions.revision;
    }
    return definitions;
  }

  function defaults(): SettingsDocument { declarations(); return validation.defaults; }
  function rawStored(): unknown {
    const row = ears().query.ids(SETTINGS_ID).pickOne(['data']);
    if (row === undefined) return {};
    return structuredClone(row.data);
  }
  function stored(): SettingsOverrides {
    const value = rawStored();
    if (!isPlainObject(value)) throw new SettingsRefusedError(['Stored settings must be a JSON object']);
    return value as SettingsOverrides;
  }
  function effective(): SettingsDocument {
    if (replacementFailure) throw replacementFailure;
    if (recovering) throw new SettingsRefusedError(['Settings require recovery. Reset the invalid values and restart.']);
    const base = defaults();
    const overrides = stored();
    validation.validate(overrides);
    return structuredClone(deepMerge(base, overrides)) as SettingsDocument;
  }
  /** In recovery the stored row is invalid, and only `recover()` may change it. */
  function refuseDuringRecovery(): void {
    if (replacementFailure) throw replacementFailure;
    if (recovering) throw new SettingsRefusedError(['Settings require recovery. Reset the invalid values and restart.']);
  }
  function getRecovery(): SettingsRecovery | undefined {
    if (replacementFailure) throw replacementFailure;
    if (!recovering) return undefined;
    declarations();
    return { version: { runId, revision }, problems: validation.inspect(rawStored()) };
  }
  const tell = (change: SettingsChange) => {
    for (const listener of listeners) {
      try { listener(change); }
      catch (error) { logger.error('Settings subscriber failed', error instanceof Error ? error : new Error(String(error))); }
    }
  };
  const targetDefinition = (target: SettingsTarget) => settingsDefinition(declarations(), target);
  function authorize(target: SettingsTarget, caller?: string, mutation = false): void {
    authorizeSettings(declarations(), target, caller, mutation);
    if (caller !== undefined && mutation && replacingData && !replacement.getStore()?.active) {
      throw new SettingsRefusedError(['Data is being replaced. Wait before changing settings.']);
    }
  }

  function compare(condition: SettingsWriteCondition | undefined, value: unknown): void {
    if (condition === undefined) return;
    if (_settingsJsonProblems(condition).length || !isPlainObject(condition) || typeof condition.runId !== 'string' || !isPlainObject(condition.expected)
      || typeof condition.expected.exists !== 'boolean') throw new SettingsRefusedError(['Invalid settings write comparison']);
    if (condition.runId !== runId || condition.expected.exists !== (value !== undefined)
      || (condition.expected.exists && !isEqual(value, condition.expected.value))) {
      throw new SettingsRefusedError(['This setting changed since editing began. Review the current value before saving.']);
    }
  }

  function write(next: unknown): void {
    declarations();
    validation.validate(next, rawStored());
    const database = ears();
    database.upsert(SETTINGS_ENTITY, { id: SETTINGS_ID, data: structuredClone(next) });
    revision++;
    tell('written');
  }

  function removeOverrides(path: readonly string[]): void {
    const before = stored();
    const next = removeIn(before, path);
    if (next !== before) write(next);
  }

  return {
    getAll: effective,
    enterRecovery: () => { recovering = true; },
    getRecovery,
    recover(request: SettingsRecoveryRequest): void {
      if (replacingData) throw new SettingsRefusedError(['Data is being replaced. Wait before repairing settings.']);
      const current = getRecovery();
      if (!current?.problems.length || !isPlainObject(request) || _settingsJsonProblems(request).length || !isEqual(request.version, current.version)) {
        throw new SettingsRefusedError(['Settings changed. Review the current problems before resetting.']);
      }
      if (request.reset === 'all') { write({}); return; }
      if (!Array.isArray(request.reset) || !request.reset.length || current.problems.some(problem => !problem.target)) {
        throw new SettingsRefusedError(['Select affected settings groups, or reset all preferences for a malformed document.']);
      }
      const affected = new Set(current.problems.map(problem => JSON.stringify(settingsTargetPath(problem.target!))));
      let next = rawStored();
      for (const target of request.reset) {
        targetDefinition(target);
        if (!affected.has(JSON.stringify(settingsTargetPath(target)))) throw new SettingsRefusedError(['Only affected settings groups can be reset during recovery.']);
        next = removeIn(next, settingsTargetPath(target));
      }
      write(next);
    },
    getSnapshot(): SettingsSnapshot {
      if (replacementFailure) throw replacementFailure;
      const published = replacementSnapshot ?? { values: effective(), catalog: declarations() };
      return { runId, revision, status: replacingData ? 'replacing' : 'ready', ...structuredClone(published) };
    },
    getOverrides: stored,
    get<T = unknown>(target: SettingsTarget, caller?: string): T {
      authorize(target, caller);
      return getIn(effective(), settingsTargetPath(target)) as T;
    },
    set(target: SettingsTarget, path: readonly string[], value: unknown, caller?: string, condition?: SettingsWriteCondition): void {
      authorize(target, caller, true);
      refuseDuringRecovery();
      if (!Array.isArray(path) || path.some(key => typeof key !== 'string')) throw new SettingsRefusedError(['Settings paths contain strings']);
      if (condition) compare(condition, getIn(effective(), [...settingsTargetPath(target), ...path]));
      write(setIn(stored(), [...settingsTargetPath(target), ...path], value));
    },
    reset(target: SettingsTarget, caller?: string): void {
      // Host reset may remove an orphan; pack code requires a current authorized declaration.
      if (caller !== undefined) authorize(target, caller, true);
      else targetDefinition(target);
      refuseDuringRecovery();
      removeOverrides(settingsTargetPath(target));
    },
    replaceAll(next: unknown, condition?: SettingsWriteCondition): void {
      refuseDuringRecovery();
      declarations();
      if (condition) compare(condition, effective());
      validation.validateEffective(next);
      write(next);
    },
    removeOverrides(path: readonly string[]): void {
      refuseDuringRecovery();
      removeOverrides(path);
    },
    resetAll: () => {
      refuseDuringRecovery();
      write({});
    },
    onChange(listener: (change: SettingsChange) => void): () => void {
      const guarded = (change: SettingsChange) => observe(() => listener(change));
      listeners.add(guarded);
      const stopCatalog = onCatalogChanged?.(() => guarded('written'));
      return () => { listeners.delete(guarded); stopCatalog?.(); };
    },
    async whileReplacingData<T>(replace: () => Promise<T>): Promise<T> {
      // Database hydration bypasses the writer. Readers retain the published view until replacement settles.
      if (replacingData === 0) replacementSnapshot = { values: effective(), catalog: declarations() };
      if (replacingData++ === 0) { revision++; tell('replacing'); }
      // Host-owned initialization/migrations may write; unrelated async callers still wait.
      const scope = { active: true };
      try { return await replacement.run(scope, replace); }
      catch (error) {
        const code = (error as { code?: unknown })?.code;
        if (code === 'COMMIT_UNKNOWN' || code === 'RECOVERY_REQUIRED') replacementFailure = error;
        throw error;
      } finally {
        scope.active = false;
        if (--replacingData === 0) { replacementSnapshot = undefined; revision++; if (!replacementFailure) tell('replaced'); }
      }
    },
  };
}
