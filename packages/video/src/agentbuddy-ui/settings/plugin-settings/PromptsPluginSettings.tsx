import {CategoryImportExportSettings} from './CategoryImportExportSettings';
import type {SettingsCategory} from '../settingsTypes';

export function PromptsPluginSettings({categories}: {categories?: SettingsCategory[]}) {
  return (
    <CategoryImportExportSettings
      categories={categories}
      categoryDescription="Organize your prompts into categories with custom colors for easy identification"
      categoryLabel="Prompt Categories"
      exportDescription="Export all prompts to a JSON file"
      importDescription="Import prompts from an exported JSON file"
      itemLabel="Prompts"
    />
  );
}
