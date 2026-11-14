export function makeStyles(prefix: string) {
  return new Proxy({} as Record<string, string>, {
    get: (_, key) => `${prefix}_${String(key)}`,
  });
}

