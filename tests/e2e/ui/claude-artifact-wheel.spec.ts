import { test } from '@apackdev/testing'
import { verifyArtifactWheel } from '../../fixtures/claude-research/artifact-wheel-journey.ts'

test('stored review notes remain reachable by wheel in the artifact sidebar', async ({ app, appPage }, testInfo) => {
  await verifyArtifactWheel({app,appPage,testInfo})
})
