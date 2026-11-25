// Regenerate the public app contract from the host's declarative definition.
import { writeFileSync } from 'node:fs';
import { generateSettingsTypes } from '../packages/apack-sdk/src/build/settings-types.ts';
import { appSettingsDefinition } from '../packages/apack-host/src/features/settings/be/app-definition.ts';
import { compileSettingsDefinition } from '../packages/apack-host/src/features/settings/compile.ts';
const types = await generateSettingsTypes(appSettingsDefinition, 'AppSettings', { validate: compileSettingsDefinition });
writeFileSync(new URL('../packages/apack-sdk/src/types/app-settings.ts', import.meta.url), '// Generated from the host app definition. Run npx tsx scripts/app-settings-types.ts.\n' + types);
