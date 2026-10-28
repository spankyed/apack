import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {getAppEnvironment, shippedPacksDir} from '../../app-environment.ts';

// API Server Configuration
export const API_CONFIG = {
  DEFAULT_PORT: 3001,
  MAX_RESTART_ATTEMPTS: 3,
  RESTART_DELAY: 2000,
  SHUTDOWN_TIMEOUT: 5000,
  SUCCESS_CHECK_DELAY: 5000,
  READY_TIMEOUT: 60000,
} as const;

// API Server Events
export const API_EVENTS = {
  STARTING: 'api:starting',
  STARTED: 'api:started',
  STOPPED: 'api:stopped',
  ERROR: 'api:error',
  RESTARTING: 'api:restarting',
  LOG: 'api:log',
} as const;

// Path Configuration
export const getApiPaths = () => {
  const isDev = !app.isPackaged;
  
  if (isDev) {
    // Development: Use app.getAppPath() to get the project root
    const appPath = app.getAppPath();
    return {
      apiPath: path.join(appPath, 'packages', 'api'),
      serverFile: 'dist/server.js',
    };
  }
  
  // Production: ASAR disabled for API compatibility
  return {
    apiPath: path.join(process.resourcesPath, 'app', 'packages', 'api'),
    serverFile: 'dist/server.js',
  };
};

// Environment Configuration
export const getEnvironment = (port: number, options: { apiToken: string; startupId?: string; logDir?: string }) => {
  const env = { ...process.env };

  // Production Electron inherits a minimal PATH missing common binary locations.
  // Windows uses "Path" not "PATH"; spread produces a case-sensitive object.
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  if (app.isPackaged && env[pathKey]) {
    const home = os.homedir();
    const extraPaths: string[] = [];

    if (process.platform === 'win32') {
      // Windows: npm global, Program Files, nvm-windows
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      extraPaths.push(path.join(appData, 'npm'));
      extraPaths.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'));
      const nvmSymlink = process.env.NVM_SYMLINK;
      if (nvmSymlink) extraPaths.unshift(nvmSymlink);
    } else {
      // macOS / Linux
      extraPaths.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/homebrew/sbin', '/usr/local/sbin');

      // CLI tools like `claude` use `#!/usr/bin/env node` shebangs, so `node`
      // must be on PATH. When installed via nvm, node lives under
      // ~/.nvm/versions/node/vX.Y.Z/bin/ which isn't in the packaged app's PATH.
      const nvmBin = process.env.NVM_BIN;
      if (nvmBin) {
        extraPaths.unshift(nvmBin);
      } else {
        const nvmNodeDir = path.join(home, '.nvm', 'versions', 'node');
        try {
          const versions = fs.readdirSync(nvmNodeDir)
            .filter(e => e.startsWith('v'))
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
          if (versions.length > 0) {
            extraPaths.unshift(path.join(nvmNodeDir, versions[0], 'bin'));
          }
        } catch { /* nvm not installed — skip */ }
      }
    }

    const existing = env[pathKey]!.split(path.delimiter);
    for (const p of extraPaths) {
      if (!existing.includes(p)) existing.push(p);
    }
    env[pathKey] = existing.join(path.delimiter);
  }

  return {
    ...env,
    NODE_ENV: app.isPackaged ? 'production' : 'development',
    API_PORT: port.toString(),
    // Clients must present it: the API refuses connections and requests without it
    APACK_API_TOKEN: options.apiToken,
    APACK_STARTUP_ID: options.startupId,
    APACK_LOG_DIR: options.logDir,
    SHIPPED_PACKS_DIR: shippedPacksDir(),
    // Identity for the API process; resolveAppEnvironment() there reads these
    APACK_ENV: getAppEnvironment().env,
    APACK_APP_MANIFEST: app.isPackaged ? path.join(app.getAppPath(), 'build-manifest.json') : undefined,
    APACK_USER_DATA_DIR: getAppEnvironment().userDataDir,
    ELECTRON_RUN_AS_NODE: '1',
  };
};

// Node Executable Configuration
export const getNodeExecutable = () => {
  // In production, use Electron's built-in Node to ensure native module compatibility
  return app.isPackaged ? process.execPath : 'node';
};

// Execution Arguments
export const getExecutionArgs = (apiPath: string, serverFile: string) => {
  // When using Electron's executable, we need to pass the full path
  const fullPath = path.join(apiPath, serverFile);
  // From source, packs' requires of workspace @apackdev/* packages resolve to their source, and stacks through the
  // development bundle's source maps name source files
  return app.isPackaged ? [fullPath] : ['--conditions=@apackdev/source', '--enable-source-maps', serverFile];
};
