import {CategoryImportExportSettings} from './CategoryImportExportSettings';
import type {SettingsSurfaceState} from '../settingsTypes';

type PromptsSettings = NonNullable<NonNullable<SettingsSurfaceState['selectedPluginSettings']>['prompts']>;

export function PromptsPluginSettings({settings}: {settings?: PromptsSettings}) {
  return (
    <CategoryImportExportSettings
      categories={settings?.categories}
      categoryDescription="Organize your prompts into categories with custom colors for easy identification"
      categoryLabel="Prompt Categories"
      exportDirectory={settings?.exportDirectory}
      exportDescription="Export all prompts to a JSON file"
      exportErrors={settings?.exportErrors}
      exportStatus={settings?.exportStatus}
      exportedFilePath={settings?.exportedFilePath}
      exportedItemCount={settings?.exportedItemCount}
      importErrors={settings?.importErrors}
      importDescription="Import prompts from an exported JSON file"
      importStatus={settings?.importStatus}
      importedCount={settings?.importedCount}
      itemLabel="Prompts"
    />
  );
}
