/**
 * Tests for the registry modules that wire default-setup features
 * into the api core without direct cross-package imports.
 */

describe('boot exports — source modules', () => {
  it('default-exports the logs state (early boot system)', async () => {
    const { isState } = await import('@apackdev/sdk/framework');
    const { default: logsSystem } = await import('#features/logs/be/system.ts');

    expect(logsSystem).toBeDefined();
    expect(isState(logsSystem)).toBe(true);
  });
});

describe('registries/services — feature services assembly', () => {
  it('does not include core services (logger, emitter, repository)', async () => {
    const { featureServices } = await import('#generated/services.ts');

    expect(featureServices).not.toHaveProperty('logger');
    expect(featureServices).not.toHaveProperty('emitter');
    expect(featureServices).not.toHaveProperty('repository');
  });
});

describe('core/content — appliers', () => {
  it("default-setup's registration carries all built-in appliers, which importCompiledContent runs for its compiled content", async () => {
    const { importCompiledContent } = await import('@apackdev/sdk/utils');
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');

    // A compiled content directory of default-setup's with no content files: every applier runs and finds nothing
    const compiledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'default-setup-content-'));
    fs.writeFileSync(path.join(compiledDir, 'content.json'), JSON.stringify({ version: 1, packId: 'default-setup', entries: [] }));
    const result = importCompiledContent({ compiledDir });
    fs.rmSync(compiledDir, { recursive: true, force: true });

    const keys = Object.keys(result);
    expect(keys).toContain('actions');
    expect(keys).toContain('prompts');
    expect(keys).toContain('flows');
    expect(keys).toContain('commands');
    expect(keys).toContain('notes');
    // Settings declarations supply defaults; applying content never writes preference overrides.
    expect(keys).not.toContain('settings');
  });

  it('exports preview function', async () => {
    const { previewPackContent } = await import('@apackdev/sdk/content');

    expect(typeof previewPackContent).toBe('function');
  });
});
