const IGNORED_ENV_FILE_ERRORS = new Set(['ENOENT', 'EISDIR', 'ENOTDIR', 'EACCES', 'EPERM']);

export function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!code || !IGNORED_ENV_FILE_ERRORS.has(code)) throw err;
  }
}

loadEnvFile();
