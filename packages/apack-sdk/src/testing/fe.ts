// Frontend-only test helpers: zero Node modules, zero EARS database, zero inference/`ai`.
export { startFeTestRuntime, stopFeTestRuntime, type FeTestRuntimeOptions } from './fe-runtime.ts';
export { fakeSettings, type FakeSettings, type FakeSettingsUpdate } from './fake-settings.ts';
export { population } from './population.ts';
export { nativeFrontendDeclarationFixture } from './frontend-declaration.ts';
