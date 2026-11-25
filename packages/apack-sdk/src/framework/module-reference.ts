/** @internal Pattern for `path#exportName` module export references. */
export const _MODULE_REFERENCE_PATTERN = /^([^#]+)#([A-Za-z_$][\w$]*)$/;
/** @internal Pattern for whole-module paths without an export selector. */
export const _MODULE_PATH_PATTERN = /^[^#]+$/;

/** @internal A whole-module contribution has no export selector. */
export function _parseModulePath(target: string, label: string): string {
  if (!_MODULE_PATH_PATTERN.test(target)) throw new Error(`${label}: "${target}" must name a module path, without an export selector`);
  return target.split('\\').join('/');
}

/** @internal Parse shared module/export syntax; callers validate type or executable purpose. */
export function _parseModuleReference(target: string, label: string, defaultExport?: 'default'): { source: string; exportName: string } {
  const reference = defaultExport && !target.includes('#') ? `${target}#${defaultExport}` : target;
  const match = _MODULE_REFERENCE_PATTERN.exec(reference);
  if (!match) throw new Error(`${label}: "${target}" must name its export, as "path#exportName"`);
  return { source: match[1]!.split('\\').join('/'), exportName: match[2]! };
}
