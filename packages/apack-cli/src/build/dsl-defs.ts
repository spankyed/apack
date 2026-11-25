import * as path from 'node:path';
import { builtinModules } from 'node:module';
import type { PackManifest } from '@apackdev/pack-format';
import type { RecordReads } from './build-reads';
import type { RecordBuildOutput } from './build-outputs.ts';
import { bundleDeclarations, isPackageSpecifier } from './types-bundler';
import { readPackCompilerConfiguration } from './compiler-configuration.ts';
import type { CompilationInputs } from './compilation-inputs.ts';
import type ts from 'typescript';

/**
 * The pack's own compiler options, with its path aliases resolved. Its tsconfig's `include` covers the
 * whole pack (components and tests included), which a definitions bundle neither needs nor can afford:
 * these options let the bundler follow the entry's imports alone.
 */
function packCompilerOptions(packDir: string, compilation?: CompilationInputs): ts.CompilerOptions {
  const options = (compilation ? compilation.declarationConfiguration : readPackCompilerConfiguration(packDir))?.options ?? {};
  // Module resolution decides whether a package import resolves at all, and the path aliases whether the
  // pack's own modules do; everything else is the compiler's business, not the bundle's.
  const { paths, baseUrl, pathsBasePath, module, moduleResolution, target, jsx } = options;
  return { paths, baseUrl, pathsBasePath, module, moduleResolution, target, jsx };
}

/**
 * Rollup renames a symbol whose name is taken (`Foo$1`), often by a global the declarations shadow anyway; those
 * suffixes only confuse completions, so they're dropped. A name two bundled declarations share keeps its suffixes:
 * dropping them would merge the declarations (the engine's `EARS` namespace with the SDK's), and the first one
 * would answer for both.
 */
export function withoutRenameSuffixes(code: string): string {
  const declared = new Set(
    [...code.matchAll(/^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:namespace|module|const|let|var|type|interface|function|class|enum)\s+([\w$]+)/gm)]
      .map((match) => match[1]),
  );
  return code.replace(/\b(\w+)\$\d+\b/g, (renamed, name: string) => (declared.has(name) ? renamed : name));
}

/** The build output holding the DSL editors' definitions, dist-relative */
const DEFS_DIR = 'defs';

/** The Monaco declarations of one DSL type, relative to the build output directory. */
export function monacoDefsFile(name: string): string {
  return path.join(DEFS_DIR, 'monaco', `${name}-defs.d.ts`);
}

/**
 * The DSL editors' type definitions: one self-contained declaration file per `dsl` entry with a
 * `monaco` target, wrapped as the `@app/defs/<name>` module Monaco loads.
 *
 * Monaco has no node_modules, so a declaration it can't resolve is a silently missing completion: the
 * pack's own modules and every `@apackdev/*` package are inlined, and `inline` adds further packages
 * (the AI SDK's, for `services.inference`). Everything else stays an import.
 */
export async function bundleDslDefs(
  packDir: string,
  outputDir: string,
  manifest: PackManifest,
  options: { recordReads?: RecordReads; compilation?: CompilationInputs; recordOutput?: RecordBuildOutput } = {},
): Promise<{ success: true; files: string[] } | { success: false; error: string }> {
  const { recordReads, compilation, recordOutput } = options;
  const entries = Object.entries(manifest.extensions?.dsl ?? {}).filter(([, def]) => def.targets.includes('monaco'));
  if (entries.length === 0) return { success: true, files: [] };
  const compilerOptions = packCompilerOptions(packDir, compilation);
  const files: string[] = [];

  for (const [name, def] of entries) {
    const outFile = path.join(outputDir, monacoDefsFile(name));
    const inlined = (id: string) => (def.inline ?? []).some((pkg) => id === pkg || id.startsWith(`${pkg}/`));
    const result = await bundleDeclarations(packDir, path.join(packDir, def.entry), outFile, {
      isExternal: (id) =>
        builtinModules.includes(id) || id.startsWith('node:')
        || (isPackageSpecifier(id) && !id.startsWith('@apackdev/') && !inlined(id)),
      // Monaco reads the file as the module the DSL editor's code is compiled against
      intro: `declare module "@app/defs/${name}" {`,
      outro: '}',
      renderChunk: withoutRenameSuffixes,
      compilerOptions,
      recordReads,
      compilation,
      recordOutput,
    });
    if (!result.success) return { success: false, error: `${name}: ${result.error}` };
    files.push(monacoDefsFile(name));
  }

  return { success: true, files };
}
