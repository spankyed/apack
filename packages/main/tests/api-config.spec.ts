import { afterEach, describe, expect, it, vi } from 'vitest';
import { app, resetElectronStub } from './electron-stub.ts';
import { getEnvironment, getUtilityExecArgv } from '../src/modules/api-server/config.ts';

afterEach(() => {
  resetElectronStub();
  vi.unstubAllEnvs();
});

describe('api-server utilityProcess configuration', () => {
  it('passes --conditions=@apackdev/source and --enable-source-maps via NODE_OPTIONS in dev without duplicating', () => {
    app.isPackaged = false;
    vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=4096 --conditions=@apackdev/source');
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');

    const env = getEnvironment(3001, { apiToken: 'tok', startupId: 'start-1' });

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe('3001');
    expect(env.APACK_API_TOKEN).toBe('tok');
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect('ELECTRON_RUN_AS_NODE' in env).toBe(false);
    expect('APACK_APP_MANIFEST' in env).toBe(false);
    const tokens = env.NODE_OPTIONS!.split(/\s+/);
    expect(tokens).toEqual(['--max-old-space-size=4096', '--conditions=@apackdev/source', '--enable-source-maps']);
  });

  it('omits source conditions in packaged builds and never stringifies undefined entries', () => {
    app.isPackaged = true;
    const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
    Object.defineProperty(process, 'resourcesPath', { value: '/stub/resources', configurable: true });
    vi.stubEnv('NODE_OPTIONS', '');
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');

    try {
      const env = getEnvironment(3001, { apiToken: 'tok' });

      expect(env.NODE_ENV).toBe('production');
      expect('ELECTRON_RUN_AS_NODE' in env).toBe(false);
      expect('APACK_STARTUP_ID' in env).toBe(false);
      expect('APACK_LOG_DIR' in env).toBe(false);
      expect(env.APACK_APP_MANIFEST).toMatch(/build-manifest\.json$/);
      expect(env.SHIPPED_PACKS_DIR).toMatch(/stub[/\\]resources[/\\]app[/\\]packages$/);
      expect(env.NODE_OPTIONS).not.toContain('--conditions=@apackdev/source');
      for (const value of Object.values(env)) {
        expect(typeof value).toBe('string');
      }
    } finally {
      if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
      else delete (process as unknown as Record<string, unknown>).resourcesPath;
    }
  });

  it('passes --inspect=127.0.0.1:0 in execArgv only when ELECTRON_INSPECT=true in dev', () => {
    app.isPackaged = false;
    vi.stubEnv('ELECTRON_INSPECT', 'true');
    expect(getUtilityExecArgv()).toEqual(['--inspect=127.0.0.1:0']);

    vi.stubEnv('ELECTRON_INSPECT', 'false');
    expect(getUtilityExecArgv()).toEqual([]);

    app.isPackaged = true;
    vi.stubEnv('ELECTRON_INSPECT', 'true');
    expect(getUtilityExecArgv()).toEqual([]);
  });
});
