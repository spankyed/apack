// The scaffold's output, as files. `apack pack init` and `apack pack add` write pack code, and pack code in a
// template literal is code no rule can read: it needed a masker that blanked `${…}` in place, an
// extension-only specifier check with no pack to resolve against, and a rule whose whole job was to check
// that the list of files holding such literals was complete (`goal-one-rule-set.md`). As files under
// `templates/`, they are ordinary pack code — every rule reads them, an author can read them, and a `${…}`
// they must emit needs no escaping.
//
// The tree under `templates/pack/` mirrors a scaffolded pack, which is load-bearing rather than tidy: a
// template's relative specifiers then resolve against real sibling files, so the own-module rule checks them
// for real instead of by looking at extensions.
// **Six of the scaffold's outputs are not template files, each for a reason that is not style:**
//
// - `MANIFEST_TEMPLATE` and `PACKAGE_JSON_TEMPLATE` are objects with computed keys and runtime-resolved version
//   ranges, `JSON.stringify`d. As files they would be JSON with placeholders in key position — not valid JSON,
//   and no rule here reads JSON anyway.
// - `PACK_TSCONFIG` is imported *as an object* by `tests/_support/pack-builds.ts`, which spreads its
//   `compilerOptions` to add a condition.
// - `ENV_DTS_TEMPLATE` is a `.d.ts`, and electron-builder strips every `.d.ts` from the packaged app whatever
//   its `files` array says — measured on a `--dir` build: zero remain in app.asar.
// - `EXAMPLE_CONTENT_TEMPLATE` is markdown, and the same file list excludes `'!**/*.md'`.
// - `GITIGNORE_TEMPLATE` would be a `templates/pack/.gitignore`, which npm reads as ignore rules for that
//   subtree when packing — silently dropping template files.
//
// Nothing here edits a file that is already there, and nothing needs to: every scaffold declares what it
// adds in `apack.json` (`add/manifest.ts`), which is a structured write that cannot half-succeed, and
// codegen carries the declaration into the pack's entries. The splicer that used to find a barrel's last
// `];` is gone with the barrels.
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * A placeholder: `__UPPER_SNAKE__`.
 *
 * It holds no `$`, `{` or `}`, so every `${…}` a template must emit — a step's `` `__LABEL__ ${index}` ``, a
 * workflow's `${{ secrets.GITHUB_TOKEN }}` — is literal text needing no escape, which is exactly what the
 * template literals this replaced could not do. And `__FOO__` is a legal identifier, object key, attribute
 * and part of a longer name (`DSL__PASCAL__Node`), so a template still parses as TypeScript and as an SFC.
 *
 * Two rules come with it. A placeholder never occupies a statement slot: it would stop the file parsing, and
 * then the rules that read it silently pass. Multi-statement variation is a second template file instead
 * (`smoke.spec.ts` and `smoke-without-surface.spec.ts`). And there is no escape for a literal `__UPPER__` —
 * nothing needs one, and `renderTemplate` throws rather than emitting one by accident.
 */
const PLACEHOLDER = /__([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)__/g;

/**
 * Where the templates are, in every layout this CLI runs in.
 *
 * `import.meta.dirname` is `<pkg>/src` from source and `<pkg>/dist/package/dist` from the bundle (esbuild
 * splits into one directory), so `..` is the package root either way — the same expression `utils.ts` uses for
 * `bin/` and `package.json`.
 *
 * **This module has to stay directly under `src/`.** One directory deeper, the source layout's `..` would be
 * `src/` while the bundle's stayed at the package root, and only `tests/acceptance/packaged-authoring/test-packaged-authoring.sh`
 * runs the published layout — so tidying this into a subdirectory would break the CLI a pack author installs
 * and nothing else.
 */
export function templatesRoot(): string {
  return path.join(import.meta.dirname, '..', 'templates');
}

/** Every template, as the path under `templates/` that names it. Walked, so nothing has to list them. */
export function templateFiles(): string[] {
  const root = templatesRoot();
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [path.relative(root, full).split(path.sep).join('/')];
  });
  if (!fs.existsSync(root)) {
    throw new Error(`No templates at ${root}. A published @apackdev/cli ships them beside bin/ and dist/; `
      + 'a build that dropped them scaffolds nothing.');
  }
  const found = walk(root).sort();
  // A root that is there and empty is the same failure as one that is missing, and worse for the checks over
  // this: three of `scaffold-templates.spec.ts`'s cases assert that a *derived* set is empty — no `.d.ts`
  // template, none unreferenced, none missing — and all three pass for free when the set they filtered was
  // empty. So it is refused here rather than in each caller, as `repoFiles` is.
  if (found.length === 0) {
    throw new Error(`No templates under ${root}, which exists. A published @apackdev/cli ships them beside `
      + 'bin/ and dist/; a build that dropped them scaffolds nothing.');
  }
  return found;
}

/**
 * A template with its placeholders filled.
 *
 * Fails loudly both ways — an unfilled placeholder and a value for a placeholder the template does not have
 * are each an error naming the template and the keys, because either one means the caller and the file have
 * drifted and the alternative is shipping `__PASCAL__` into someone's pack. The placeholders are read from
 * the template, not from the output, so a value that happens to contain `__LIKE_THIS__` is not mistaken for
 * one; and the substitution is a single pass, so a value naming another placeholder is never re-substituted.
 */
export function renderTemplate(name: string, values: Record<string, string> = {}): string {
  const file = path.join(templatesRoot(), name);
  if (!fs.existsSync(file)) {
    throw new Error(`No template "${name}" in ${templatesRoot()}`);
  }
  const body = fs.readFileSync(file, 'utf-8');
  const wanted = new Set([...body.matchAll(PLACEHOLDER)].map((match) => match[1] as string));
  const missing = [...wanted].filter((key) => !(key in values)).sort();
  const unused = Object.keys(values).filter((key) => !wanted.has(key)).sort();
  if (missing.length > 0 || unused.length > 0) {
    throw new Error([
      `Template "${name}" was rendered with the wrong values:`,
      ...missing.map((key) => `  - __${key}__ has no value`),
      ...unused.map((key) => `  - ${key} was passed and the template does not use it`),
    ].join('\n'));
  }
  return body.replace(PLACEHOLDER, (_, key: string) => values[key] as string);
}
