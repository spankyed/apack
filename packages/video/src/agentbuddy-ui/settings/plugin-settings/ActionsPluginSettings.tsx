import {CategoryImportExportSettings} from './CategoryImportExportSettings';
import type {SettingsSurfaceState} from '../settingsTypes';

type ActionsSettings = NonNullable<NonNullable<SettingsSurfaceState['selectedPluginSettings']>['actions']>;

export function ActionsPluginSettings({settings}: {settings?: ActionsSettings}) {
  return (
    <CategoryImportExportSettings
      categories={settings?.categories}
      categoryDescription="Organize your actions into categories with custom colors for better workflow management"
      categoryLabel="Action Categories"
      exportDirectory={settings?.exportDirectory}
      exportDescription="Export all actions to a JSON file"
      exportErrors={settings?.exportErrors}
      exportStatus={settings?.exportStatus}
      exportedFilePath={settings?.exportedFilePath}
      exportedItemCount={settings?.exportedItemCount}
      importErrors={settings?.importErrors}
      importDescription="Import actions from an exported JSON file"
      importStatus={settings?.importStatus}
      importedCount={settings?.importedCount}
      itemLabel="Actions"
    />
  );
}
