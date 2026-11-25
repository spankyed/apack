import type { SettingsCatalog, SettingsDefinition } from '@apackdev/sdk/framework';
import { deepMerge, hasOwn, isPlainObject } from '@apackdev/sdk/utils/pure';
import { settingsTargetPath, type AppSettings, type SettingsDocument, type SettingsTarget, type SettingsProblem } from '@apackdev/sdk/types';
import type { FeatureRef } from '@apackdev/sdk/ids';
import { getIn, isEqual, settingsProblems, SettingsRefusedError } from './document.ts';
import { compileSettingsDefinition } from './compile.ts';

/** Compile one accepted revision; live writes and backup preflight validate through the same rules. */
export function compileSettingsCatalog(catalog: SettingsCatalog) {
  const validators = new Map<string, { path: readonly string[]; issues(value: unknown): SettingsProblem[] }>();
  const compile = (target: SettingsTarget, definition: SettingsDefinition) => {
    const path = settingsTargetPath(target);
    const validator = compileSettingsDefinition(definition);
    validators.set(JSON.stringify(path), { path, issues: value => validator.validate(value)
      .map(issue => ({ target, path: issue.path.map(String), message: issue.message })) });
    return structuredClone(definition.defaults);
  };
  const defaults: SettingsDocument = {
    app: compile({ kind: 'app' }, catalog.app) as unknown as AppSettings,
    packs: Object.fromEntries(Object.entries(catalog.packs).map(([packId, groups]) => [packId,
      Object.fromEntries(Object.entries(groups).map(([groupId, definition]) => [groupId, compile({ kind: 'pack', packId, groupId }, definition)]))])),
    features: Object.fromEntries(Object.entries(catalog.features).map(([ref, definition]) =>
      [ref, compile({ kind: 'feature', featureRef: ref as FeatureRef }, definition)])),
  };

  const format = (issue: SettingsProblem) => `${issue.target ? settingsTargetPath(issue.target).join('/') : 'settings'} ${issue.path.join('.') || 'settings'}: ${issue.message}`;
  const problemsFor = (validator: { issues(value: unknown): SettingsProblem[] }, value: unknown) => validator.issues(value).map(format);

  return {
    defaults,
    inspect(overrides: unknown): SettingsProblem[] {
      const shape = settingsProblems(overrides);
      if (shape.length) return shape.map(message => ({ path: [], message }));
      const effective = deepMerge(defaults, overrides);
      return [...validators.values()].flatMap(validator => validator.issues(getIn(effective, validator.path)));
    },
    /** A transported effective document must be complete, not completed by merging defaults. */
    validateEffective(value: unknown): void {
      const problems = settingsProblems(value);
      if (!isPlainObject(value)) throw new SettingsRefusedError(problems);
      for (const owner of ['app', 'packs', 'features']) {
        if (!hasOwn(value, owner)) problems.push(`Missing settings owner ${owner}`);
      }
      for (const validator of validators.values()) problems.push(...problemsFor(validator, getIn(value, validator.path)));
      if (problems.length) throw new SettingsRefusedError(problems);
    },
    /** Import retains well-formed unavailable owners; edits may only retain their prior values. */
    validate(overrides: unknown, previous?: unknown): void {
      const problems = settingsProblems(overrides);
      if (problems.length) throw new SettingsRefusedError(problems);
      const candidate = deepMerge(defaults, overrides) as SettingsDocument;
      const before = previous === undefined ? undefined : deepMerge(defaults, previous);
      const check = (target: SettingsTarget, value: unknown) => {
        const path = settingsTargetPath(target);
        const validator = validators.get(JSON.stringify(path));
        if (!validator) {
          if (before !== undefined && !isEqual(value, getIn(before, path))) problems.push(`Unavailable settings owner ${path.join('/')}`);
          return;
        }
        problems.push(...problemsFor(validator, value));
      };
      check({ kind: 'app' }, candidate.app);
      for (const [packId, groups] of Object.entries(candidate.packs)) {
        for (const [groupId, value] of Object.entries(groups)) check({ kind: 'pack', packId, groupId }, value);
      }
      for (const [featureRef, value] of Object.entries(candidate.features)) check({ kind: 'feature', featureRef: featureRef as FeatureRef }, value);
      if (problems.length) throw new SettingsRefusedError(problems);
    },
  };
}
