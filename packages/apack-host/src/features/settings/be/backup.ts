import type { Ears, EARS } from '@apackdev/ears';
import type { SettingsCatalog } from '@apackdev/sdk/framework';
import { compileSettingsCatalog } from '../validation.ts';

/** Validate copied preferences, read through an engine on the backup's files, without changing live data. */
export function createSettingsBackupValidator(catalog: SettingsCatalog): (ears: Ears) => void {
  const validation = compileSettingsCatalog(catalog);
  return (ears) => {
    // Absent is no preferences; a stored `null` is a value, and refused
    const data = ears.getAttr('Settings-app' as EARS.EntityId, 'data' as EARS.AttrKind);
    validation.validate(data === undefined ? {} : data);
  };
}
