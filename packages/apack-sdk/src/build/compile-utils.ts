export interface CompileConfig {
  sourceDir: string;
  outputFile: string;
  functionName: string;
  isAsync: boolean;
  fields: {
    metaInput: string;
    fnBody: string;
    output: string;
  };
}

export interface CompiledEntry {
  label: string;
  description?: string;
  category?: string;
  contentHash: string;
  [key: string]: unknown;
}

export interface CompileResult {
  entries: CompiledEntry[];
  /** Soft issues; the entry was still produced. */
  warnings: string[];
  /** Hard failures; the entry was dropped and the build must not continue. */
  errors: string[];
}

export interface BundleResult {
  bundledJs: string;
  errors: string[];
  warnings: string[];
}

export { contentHash } from './content-hash.ts';

export async function bundleFile(filePath: string): Promise<BundleResult> {
  const compiler = await import('./compile-source.ts');
  return compiler.bundleFile(filePath);
}

export async function compileSourceDir(
  sourceDir: string,
  config: Omit<CompileConfig, 'sourceDir' | 'outputFile'>,
): Promise<CompileResult> {
  const compiler = await import('./compile-source.ts');
  return compiler.compileSourceDir(sourceDir, config);
}
