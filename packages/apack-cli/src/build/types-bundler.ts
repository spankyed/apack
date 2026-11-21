import * as fs from 'node:fs';
import * as path from 'node:path';
import { sortLiteralUnions } from './declaration-text';
import type { RecordReads } from './build-reads';
import type { RecordBuildOutput } from './build-outputs.ts';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import ts from 'typescript';
import { compilerReadOptions, readPackCompilerConfiguration } from './compiler-configuration.ts';
import { isBuiltin } from 'node:module';
import type { CompilationInputs } from './compilation-inputs.ts';

/** A package specifier (`vue`, `@elmdb/ears`), not a relative path or a pack's own `#` subpath */
export function isPackageSpecifier(id: string): boolean {
  return !id.startsWith('.') && !path.isAbsolute(id) && !id.startsWith('#') && !id.startsWith('\0');
}

/**
 * Bundles a pack's facade types (src/__generated__/pack-types.ts: entity shapes, surface events,
 * services, repositories) into one declaration file that dependents import. The pack's own
 * modules and its dependencies' facade types are inlined; packages stay imports.
 */
export async function bundlePackTypes(packDir: string, outFile: string, options: Pick<BundleDeclarationsOptions, 'recordReads' | 'compilation' | 'recordOutput'> = {}): Promise<{ success: true; content: string } | { success: false; error: string }> {
  return bundleDeclarations(packDir, path.join(packDir, 'src', '__generated__', 'pack-types.ts'), outFile, options);
}

export interface BundleDeclarationsOptions {
  compilation?: CompilationInputs;
  /** Which package ids stay imports. Authored path aliases and baseUrl modules are inlined. */
  isExternal?: (id: string) => boolean;
  /** Text placed before and after the declarations, to wrap them in a module */
  intro?: string;
  outro?: string;
  /** Applied to the bundled declarations before they're written */
  renderChunk?: (code: string) => string;
  /**
   * Compile with these options instead of the pack's tsconfig.json. The tsconfig's `include` becomes the
   * program's files, so a bundle that needs only the entry's imports passes the options it needs instead.
   */
  compilerOptions?: ts.CompilerOptions;
  /**
   * Where this bundle reports the files it read, for the build's record of its inputs. Rollup's
   * `watchFiles` is the declaration program's file list, which is where another package's `.d.ts` is read.
   */
  recordReads?: RecordReads;
  recordOutput?: RecordBuildOutput;
}

/**
 * Bundles the declarations of a pack module (`input`) into one declaration file: the pack's own
 * modules are inlined, packages stay imports.
 */
export async function bundleDeclarations(
  packDir: string,
  input: string,
  outFile: string,
  options: BundleDeclarationsOptions = {},
): Promise<{ success: true; content: string } | { success: false; error: string }> {
  const { rollup, VERSION } = await import('rollup');
  const { dts } = await import('rollup-plugin-dts');
  const tsconfig = path.join(packDir, 'tsconfig.json');
  let tree: ReturnType<CompilationInputs['readTree']> | undefined;
  let configDirectory: string | undefined;
  try {
    tree = options.compilation?.readTree();
    const inherited = options.compilation ? options.compilation.declarationConfiguration?.options ?? {}
      : readPackCompilerConfiguration(packDir)?.options ?? {};
    const compilerOptions = tree ? compilerReadOptions({ ...inherited, ...options.compilerOptions }, tree.path)
      : options.compilerOptions ?? inherited;
    const readRoot = tree?.path(packDir) ?? packDir;
    const readInput = tree?.path(input) ?? input;
    let readConfig = tree || options.compilerOptions || !fs.existsSync(tsconfig) ? undefined : tsconfig;
    if (tree) {
      configDirectory = fs.mkdtempSync(path.join(tree.workDirectory, 'declarations-'));
      readConfig = path.join(configDirectory, 'tsconfig.json');
      const ambient = options.compilation?.declarationConfiguration?.rootFiles.filter(file => /\.d\.[cm]?ts$/.test(file)) ?? [];
      fs.writeFileSync(readConfig, JSON.stringify({ files: [readInput, ...ambient.map(tree.path)] }), { flag: 'wx', mode: 0o400 });
    }
    const resolution = ts.createModuleResolutionCache(readRoot, file => ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase(), compilerOptions);
    const isExternal = options.isExternal ?? isPackageSpecifier;
    const aliases = Object.keys(compilerOptions.paths ?? {});
    const bundle = await rollup({
      input: readInput,
      external(id, importer) {
        if (!isExternal(id)) return false;
        if (!isPackageSpecifier(id)) return true;
        if (isBuiltin(id)) return true;
        const resolved = ts.resolveModuleName(id, importer ?? readInput, compilerOptions, ts.sys, resolution).resolvedModule;
        const packageName = id.split('/').slice(0, id.startsWith('@') ? 2 : 1).join('/');
        // Catch-all mappings may resolve genuine packages too; preserve those imports by package identity.
        if (resolved?.isExternalLibraryImport && resolved.packageId?.name === packageName) return true;
        const alias = aliases.some(alias => {
          const star = alias.indexOf('*');
          return star < 0 ? id === alias : id.startsWith(alias.slice(0, star))
            && id.endsWith(alias.slice(star + 1)) && id.length >= alias.length - 1;
        });
        return !alias && (!resolved || resolved.isExternalLibraryImport === true);
      },
      plugins: [dts({
        respectExternal: true,
        tsconfig: readConfig,
        compilerOptions: {
          ...(tree && declarationOptions(compilerReadOptions(inherited, tree.path))),
          // A pack linked to a checkout reads @apackdev/* declarations from source
          allowImportingTsExtensions: true,
          skipLibCheck: true,
          ...(tree ? compilerReadOptions(options.compilerOptions ?? {}, tree.path) : options.compilerOptions),
        },
      })],
      onwarn(warning, warn) {
        if (warning.code !== 'UNRESOLVED_IMPORT') warn(warning);
      },
    });
    let code: string;
    try {
      const { output } = await bundle.generate({ format: 'es', intro: options.intro, outro: options.outro });
      options.recordReads?.({ bundler: 'rollup', version: VERSION, files: bundle.watchFiles.map(file => tree?.sourcePath(file) ?? file) });
      code = output[0].code;
    } finally {
      await bundle.close();
    }
    const rendered = options.renderChunk ? options.renderChunk(code) : code;
    // Here rather than in each caller, so every declaration bundle this function writes is reproducible and a
    // fourth caller cannot forget: the facade, the DSL defs and the flow helpers all come through here
    const content = sortLiteralUnions(rendered, outFile);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, content);
    options.recordOutput?.(outFile, content);
    return { success: true, content };
  } catch (err) {
    return { success: false, error: tree?.diagnostic(errorMessage(err)) ?? errorMessage(err) };
  } finally {
    if (configDirectory) fs.rmSync(configDirectory, { recursive: true, force: true, maxRetries: 5 });
  }
}

/** Keep the declaration plugin's emission defaults authoritative, as with its own tsconfig reader. */
function declarationOptions(options: ts.CompilerOptions): ts.CompilerOptions {
  const result = { ...options };
  for (const key of ['declaration', 'noEmit', 'emitDeclarationOnly', 'noEmitOnError', 'checkJs',
    'declarationMap', 'skipLibCheck', 'preserveSymlinks', 'target', 'resolveJsonModule']) delete result[key];
  return result;
}
