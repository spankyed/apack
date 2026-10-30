// API reports for every code export of a published package (etc/<entry>.api.md), from
// declarations emitted into .temp/api-types. A component's declaration is only its default export,
// so each component entry also gets a contract report (etc/<entry>.component.md): the props,
// emits, slots and exposed members TypeScript resolves for it. Without --local, fails when a
// report is out of date or API Extractor reports a problem.
//
//   tsx scripts/api-reports.ts packages/apack-sdk [--local]
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CompilerState, Extractor, ExtractorConfig, ExtractorLogLevel } from '@microsoft/api-extractor';
import { packagesBuiltOrRefuse, PUBLISHED_TREES } from '@apackdev/host/build/packages-built';
import { componentContracts, type ComponentEntry } from './component-contracts.ts';
import { reportEntries, reportName } from './lib/api-entries.ts';

const pkgDir = path.resolve(process.argv[2] ?? '');
const local = process.argv.includes('--local');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
const typesDir = path.join(pkgDir, '.temp', 'api-types');
const reportFolder = path.join(pkgDir, 'etc');

/**
 * Refuses rather than rebuilds, which is the difference between a checker and a fixer.
 *
 * A report generated against a stale `dist` is a report about the wrong tree, so the freshness has to be
 * established — but **establishing it by building makes this a step that writes what it declares as its
 * inputs.** Measured 2026-10-05, when it did: `api:check` rebuilt `@apackdev/testing` mid-chain and the
 * freshness sweep then named twenty steps that had passed and would not be cached, with
 * `packages:ensure`'s own output as the file that moved under them.
 *
 * **This module is both halves, so the fixer sits in front of the command rather than here.** That is the
 * rule `@apackdev/testing`'s guide states for the same pair: a fixer belongs to the command a user runs, and a
 * checker must not try to repair. So the root `api:update` carries `packages:ensure &&` (door 1 there) and
 * the root `api:check` does not — the chain step runs that script, and a rebuild inside it is the failure
 * above.
 */
packagesBuiltOrRefuse('npm run packages:build');

/**
 * Exports with declarations: [subpath, declaration file in .temp/api-types].
 *
 * Two kinds of package, because two kinds resolve differently. `@apackdev/ears`, `/sdk` and `/ui` carry an
 * `@apackdev/source` branch per entry, which names the source file directly. A **bundled** package
 * (`@apackdev/testing`) deliberately carries none — it resolves its built bundle for everyone, which is what
 * makes the fixture a pack runs the one this repo runs — so its entry is read from `types` instead, whose
 * path is its published tree (`PUBLISHED_TREES`) plus the `dist/` tsc emits into. Declarations under
 * `.temp/api-types` mirror `src/` either way, so both arrive at the same relative path.
 */
function entries(): [string, string][] {
  const bundled = PUBLISHED_TREES[path.basename(pkgDir)];
  return reportEntries(pkg as { exports?: Record<string, unknown> }).map((key) => {
    const target = (pkg.exports as Record<string, Record<string, unknown>>)[key];
    const source = target['@apackdev/source'] as string | undefined;
    const rel = source !== undefined
      ? source.replace(/^\.\/src\//, '')
      : (target.types as string).replace(new RegExp(`^\\./${bundled}/dist/`), '');
    const declaration = rel.endsWith('.vue') ? `${rel}.d.ts` : rel.replace(/\.(ts|d\.ts)$/, '.d.ts');
    return [key, path.join(typesDir, declaration)];
  });
}

// Only the half that records needs the folder. Unconditional, this was the one write `api:check` made
// outside `.temp/` — an empty `etc/` created by a check, where the absence of a report is a thing the
// comparison below has an answer for
if (local) fs.mkdirSync(reportFolder, { recursive: true });
let failed = 0;
/** Reports this run changed: written in --local, or found stale otherwise */
let changed = 0;
const expected = new Set<string>();
/** One entry's extractor configuration. Built for every entry up front, so one compiler state can serve them all. */
function configFor(key: string, declaration: string): ExtractorConfig {
  const reportFileName = reportName(key);
  return ExtractorConfig.prepare({
    configObject: {
      projectFolder: pkgDir,
      mainEntryPointFilePath: declaration,
      // The committed reports end lines with LF; API Extractor's default is CRLF, which rewrites every line of a report
      newlineKind: 'lf',
      compiler: { tsconfigFilePath: path.join(pkgDir, 'tsconfig.api-extractor.json') },
      apiReport: { enabled: true, reportFolder, reportFileName, reportTempFolder: path.join(pkgDir, '.temp') },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      // Only ExtractorConfig.loadFile() applies API Extractor's own api-extractor-defaults.json;
      // prepare() takes this object as given, and MessageRouter's built-in fallback is "none" for
      // every category. Without these, nothing is ever reported: not a TypeScript error, not a type
      // a public export names but doesn't export, not a bad release tag. They mirror the defaults,
      // apart from the two turned off on purpose below.
      messages: {
        compilerMessageReporting: { default: { logLevel: ExtractorLogLevel.Warning } },
        extractorMessageReporting: {
          default: { logLevel: ExtractorLogLevel.Warning },
          // A type a public entry names without exporting it. Off: most are exported from another
          // entry of the same package, so a consumer can still name them, and recording all of them
          // buries the messages below in the reports
          'ae-forgotten-export': { logLevel: ExtractorLogLevel.None },
          'ae-incompatible-release-tags': { logLevel: ExtractorLogLevel.Warning, addToApiReportFile: true },
          'ae-internal-missing-underscore': { logLevel: ExtractorLogLevel.Warning, addToApiReportFile: true },
          'ae-internal-mixed-release-tag': { logLevel: ExtractorLogLevel.Warning, addToApiReportFile: true },
          'ae-undocumented': { logLevel: ExtractorLogLevel.None },
          'ae-unresolved-inheritdoc-reference': { logLevel: ExtractorLogLevel.Warning, addToApiReportFile: true },
          'ae-unresolved-inheritdoc-base': { logLevel: ExtractorLogLevel.Warning, addToApiReportFile: true },
          'ae-wrong-input-file-type': { logLevel: ExtractorLogLevel.Error },
          // Every export in these packages is public API; a tag is only how `@internal` is marked
          'ae-missing-release-tag': { logLevel: ExtractorLogLevel.None },
        },
        // TSDoc syntax isn't part of the contract these reports protect
        tsdocMessageReporting: { default: { logLevel: ExtractorLogLevel.None } },
      },
    },
    configObjectFullPath: undefined,
    packageJsonFullPath: path.join(pkgDir, 'package.json'),
  });
}

const all = entries();
const prepared = all.map(([key, declaration]) => {
  expected.add(reportName(key));
  return { key, config: configFor(key, declaration) };
});

/**
 * One TypeScript program for all of a package's entries, rather than one per entry.
 *
 * `Extractor.invoke` builds its own program when it is given no state, and a package's entries are
 * compiled against the same declarations — so the work was being repeated once per entry: 28 programs for
 * `@apackdev/sdk`, 68 for `@apackdev/ui`. `additionalEntryPoints` is what makes one program cover them all, and
 * sharing it is the documented purpose of `IExtractorInvokeOptions.compilerState`.
 *
 * Measured 2026-10-04: `@apackdev/sdk`'s 28 entries 12.3s -> 1.1s, `@apackdev/ui`'s 68 30s -> 0.9s, with every
 * report reproduced byte for byte. The reports are what prove it stays true — a divergence moves one, and
 * `api:check` fails on a moved report. What covers the case this most depends on — an API Extractor upgrade
 * changing what sharing a compiler state means — is that the step declares `package-lock.json`, so a bumped
 * `@microsoft/api-extractor` invalidates it and every report is taken again and compared.
 */
const compilerState = prepared.length === 0 ? undefined : CompilerState.create(prepared[0].config, {
  additionalEntryPoints: all.slice(1).map(([, declaration]) => declaration),
});

for (const { key, config } of prepared) {
  const result = Extractor.invoke(config, { localBuild: local, showVerboseMessages: false, compilerState });
  if (result.apiReportChanged) changed++;
  if (!result.succeeded) {
    failed++;
    console.error(`${pkg.name}${key.slice(1)}: ${result.errorCount} error(s), ${result.warningCount} warning(s)${result.apiReportChanged ? ', report changed' : ''}`);
  }
}

/**
 * Component entries (a .ts module re-exporting an SFC's default).
 *
 * An entry with no `@apackdev/source` branch is a bundled package's, which has no source tree to read and
 * no SFC to find: components are `@apackdev/ui`'s, and that one names its source.
 */
function componentEntries(): ComponentEntry[] {
  return entries().flatMap(([key, declaration]) => {
    const source = (pkg.exports[key] as Record<string, string>)['@apackdev/source'];
    if (source === undefined) return [];
    const sfc = /export\s*\{\s*default\s*\}\s*from\s*['"]([^'"]+\.vue)['"]/.exec(fs.readFileSync(path.join(pkgDir, source), 'utf-8'));
    if (!sfc) return [];
    // The entry only re-exports; the SFC's own declaration is where the component is declared
    return [{ key, declaration, componentDeclaration: path.join(path.dirname(declaration), `${path.basename(sfc[1])}.d.ts`) }];
  });
}

// componentContracts builds a TypeScript program, which is the slow part of this script. A package
// with no component entries (@apackdev/ears, @apackdev/sdk) has nothing for it to report, so don't.
const components = componentEntries();
const contracts = components.length === 0 ? [] : componentContracts({
  packageName: pkg.name,
  projectDir: pkgDir,
  typesDir,
  tsconfigPath: path.join(pkgDir, 'tsconfig.api-extractor.json'),
  components,
});

for (const [key, contract] of contracts) {
  const file = reportName(key).replace(/\.api\.md$/, '.component.md');
  expected.add(file);
  const current = fs.existsSync(path.join(reportFolder, file)) ? fs.readFileSync(path.join(reportFolder, file), 'utf-8') : undefined;
  if (current === contract) continue;
  changed++;
  if (local) fs.writeFileSync(path.join(reportFolder, file), contract);
  else { failed++; console.error(`etc/${file} is out of date; run api:update`); }
}

// Reports for exports that no longer exist
for (const file of fs.readdirSync(reportFolder).filter((f) => /\.(api|component)\.md$/.test(f) && !expected.has(f))) {
  changed++;
  if (local) fs.rmSync(path.join(reportFolder, file));
  else { failed++; console.error(`etc/${file} has no matching export; run with --local to remove it`); }
}

if (failed > 0) process.exit(1);
// How many reports the run *changed*, not how many it looked at — the one question its reader has: a doc
// edit that reaches the declarations but no report is a routine reason to run this, and has to read
// differently from a signature having changed.
console.log(local
  ? `${pkg.name}: ${changed} of ${expected.size} API reports updated`
  : `${pkg.name}: ${expected.size} API reports up to date`);
