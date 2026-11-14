import {CategoryImportExportSettings} from './CategoryImportExportSettings';
import type {SettingsCategory} from '../settingsTypes';

export function ActionsPluginSettings({categories}: {categories?: SettingsCategory[]}) {
  return (
    <CategoryImportExportSettings
      categories={categories}
      categoryDescription="Organize your actions into categories with custom colors for better workflow management"
      categoryLabel="Action Categories"
      exportDescription="Export all actions to a JSON file"
      importDescription="Import actions from an exported JSON file"
      itemLabel="Actions"
    />
  );
}
