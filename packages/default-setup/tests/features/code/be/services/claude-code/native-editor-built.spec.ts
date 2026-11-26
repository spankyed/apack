import {readFile} from 'node:fs/promises'
import {buildNativeEditorProgram, RECORDED_EDITOR_PROGRAM} from '../../../../../../scripts/build-native-editor.ts'

it('holds the recorded editor child to its current real-module source', async () => {
  expect(await readFile(RECORDED_EDITOR_PROGRAM, 'utf8'), 'run npm run editor:update -w @app/default-setup').toBe(await buildNativeEditorProgram())
})
