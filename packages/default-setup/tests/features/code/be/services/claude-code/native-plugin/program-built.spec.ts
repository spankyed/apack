import { readFile } from 'node:fs/promises'
import { buildNativePluginProgram, RECORDED_PLUGIN_PROGRAM } from '../../../../../../../scripts/build-native-plugin.ts'

/**
 * The committed program is a derivation, so it is re-taken here rather than trusted.
 *
 * The pack carries the plugin as *text* — it runs in the CLI's runtime, not this one — so nothing else
 * reads it, and a stale copy would only be noticed the next time a native terminal launched with the
 * program from before the edit.
 */
it('matches the program a fresh bundle of native-plugin/ produces', async () => {
  const built = await buildNativePluginProgram()
  const held = await readFile(RECORDED_PLUGIN_PROGRAM, 'utf8')
  expect(held, 'run `npm run plugin:update -w @app/default-setup` and commit the result').toBe(built)
})

