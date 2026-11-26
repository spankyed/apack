import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { root, write } from './pack.ts';

/**
 * One `ts.SourceFile` cache per worker across the programs a compiling spec builds, so the SDK and ears
 * source is parsed once instead of on every case. Each program resolves `@apackdev/sdk` under
 * `@apackdev/source` (~165 source files); `root` is `mkdtemp`'d per test so files under `root` are never cached.
 */
const parsed = new Map<string, ts.SourceFile | undefined>();
let compilerHost: ts.CompilerHost | undefined;

function sharedHost(options: ts.CompilerOptions): ts.CompilerHost {
  if (!compilerHost) {
    const host = ts.createCompilerHost(options, true);
    const read = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
      if (fileName.startsWith(root)) return read(fileName, languageVersion, onError, shouldCreate);
      if (!parsed.has(fileName)) parsed.set(fileName, read(fileName, languageVersion, onError, shouldCreate));
      return parsed.get(fileName);
    };
    compilerHost = host;
  }
  return compilerHost;
}

/** Type-checks the generated files at `names` with `root` linked to this SDK's source, and returns diagnostics. */
export function typecheck(files: Record<string, string>, names: string[], noUnusedLocals = false): string[] {
  for (const [file, content] of Object.entries(files)) if (content) write(file, content);
  write('package.json', JSON.stringify({ type: 'module' }));
  const sdk = path.resolve(import.meta.dirname, '../../../../apack-sdk');
  const fromSdk = (name: string) => {
    for (let dir = sdk; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', ...name.split('/'));
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
      if (path.dirname(dir) === dir) throw new Error(`Could not locate ${name} from ${sdk}`);
    }
  };
  // The generated facades import the engine and state primitive too, which a pack installs with the SDK. `zod` is
  // intentionally omitted so any generated import of `zod` fails typecheck with TS2307.
  const links = {
    '@apackdev/sdk': sdk,
    '@apackdev/state': fromSdk('@apackdev/state'),
    '@elmdb/ears': fromSdk('@elmdb/ears'),
    vue: fromSdk('vue'),
    '@vue/runtime-core': fromSdk('@vue/runtime-core'),
  };
  for (const [name, target] of Object.entries(links)) {
    const link = path.join(root, 'node_modules', name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    if (!fs.existsSync(link)) fs.symlinkSync(target, link, 'dir');
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    customConditions: ['@apackdev/source'],
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    strict: true,
    noUnusedLocals,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const program = ts.createProgram({ rootNames: names.map((name) => path.join(root, name)), options, host: sharedHost(options) });
  return ts.getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName.startsWith(root))
    .map((d) => `${path.relative(root, d.file!.fileName)}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}
