import { _packServiceSelection, _parseServiceReference } from '@apackdev/sdk/framework';
import { HOST_PACK_ID } from '@apackdev/sdk/ids';
import * as path from 'node:path';
import {
  generatePackFiles, packValidation, validateManifest, validatePackSources,
  type PackDiagnostic, type PackValidation, type SkippedPackCheck,
} from '@apackdev/sdk/build';
import { compileSettingsDefinition, settingsDeclarationDiagnostics } from '@apackdev/host/packs';
import { dependencyTypes, type ResolvedDeps } from './generate';
import { inspectDependencies, type DependencyInspection } from '../build/dependency-inspection.ts';
import { findPackRoot, readManifest } from '../utils';
import { packRuleProblems, PACK_RULES } from '../build/pack-rules.ts';
import { errorMessage } from '@apackdev/sdk/utils/pure';

/** Authoring checks are read-only; unresolved dependencies leave a useful but incomplete report. */
export async function validatePack(root: string): Promise<PackValidation & { dependencies: DependencyInspection[] }> {
  const manifestResult = validateManifest(path.join(root, 'apack.json'));
  const diagnostics: PackDiagnostic[] = [...manifestResult.diagnostics];
  const skippedChecks: SkippedPackCheck[] = [];
  let packId: string | undefined;
  let dependencies: DependencyInspection[] = [];
  let manifestValid = manifestResult.status === 'valid';
  let manifest: ReturnType<typeof readManifest> | undefined;
  if (manifestValid) {
    manifest = readManifest(root);
    const settingsDiagnostics = settingsDeclarationDiagnostics(manifest);
    if (settingsDiagnostics.length) {
      diagnostics.push(...settingsDiagnostics);
      manifestValid = false;
    }
  }

  if (manifestValid && manifest) {
    packId = manifest.id;
    const sources = validatePackSources(root, manifest);
    diagnostics.push(...sources.diagnostics);
    let resolved: ResolvedDeps | undefined;
    const inspection = await inspectDependencies(root, manifest.dependencies);
    dependencies = inspection.entries;
    const failed = dependencies.filter(entry => entry.status !== 'resolved');
    if (failed.length) {
      const reason = failed.map(entry => `${entry.id} (${entry.spec}): ${entry.problem}`).join('; ');
      diagnostics.push({
        code: 'dependency.unresolved', severity: 'warning', packId, path: ['dependencies'],
        message: reason, suggestion: 'Run "apack pack fetch-deps"; build linked dependencies first.',
      });
      skippedChecks.push({ check: 'dependencies', reason });
    } else resolved = dependencyTypes(inspection.files);

    // Required APIs are declaration data: invalid own source must not hide a provider error.
    const requiredProviders = (manifest.consumes?.services ?? []).map(ref => _parseServiceReference(ref).packId)
      .filter(id => id !== manifest.id && id !== HOST_PACK_ID);
    if (requiredProviders.some(id => !inspection.files.has(id))) {
      skippedChecks.push({ check: 'consumed-services', reason: 'Requires local declarations for the requested service providers.' });
    } else {
      try {
        _packServiceSelection({ ...manifest, services: manifest.extensions?.services }, id => {
          const declaration = inspection.files.get(id)?.snapshot.manifest;
          return declaration && { ...declaration, services: declaration.extensions?.services };
        });
      } catch (error) {
        diagnostics.push({ code: 'consumed-services.invalid', severity: 'error', packId,
          path: ['consumes', 'services'], message: errorMessage(error) });
      }
    }

    if (sources.status !== 'valid' || !resolved) {
      skippedChecks.push({ check: 'codegen', reason: 'Requires valid declared sources and resolved dependencies.' });
    } else {
      try {
        // Generates in memory: checks exports, contracts and content without writing generated files.
        await generatePackFiles(manifest, {
          packRoot: root,
          depTypes: resolved.depTypes,
          depSnapshots: resolved.depSnapshots,
          validateSettings: compileSettingsDefinition,
        });
      } catch (err) {
        diagnostics.push({ code: 'codegen.failed', severity: 'error', packId, path: [], message: errorMessage(err) });
        skippedChecks.push({ check: 'remaining-codegen', reason: 'Code generation stopped at its first error.' });
      }
    }
  } else {
    for (const check of ['declared-sources', 'dependencies', 'codegen', 'source-rules']) {
      skippedChecks.push({ check, reason: 'Requires a valid manifest.' });
    }
    return { ...packValidation(diagnostics, skippedChecks), dependencies };
  }

  // Independent source rules still run when other checks fail.
  for (const [key, found] of packRuleProblems(root)) {
    const rule = PACK_RULES.find(candidate => candidate.key === key);
    for (const problem of found) {
      diagnostics.push({
        code: `rule.${key}`, severity: 'error', packId, path: [],
        message: `${problem}  (${key}: ${rule?.rule ?? ''})`,
      });
    }
  }
  return { ...packValidation(diagnostics, skippedChecks), dependencies };
}

export async function validate(args: string[]) {
  const unknown = args.filter(arg => arg !== '--json');
  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.join(', ')}`);
  const root = findPackRoot(process.cwd());
  const report = await validatePack(root);
  if (args.includes('--json')) {
    console.log(JSON.stringify(report));
  } else {
    console.log(`Validating pack at: ${root}`);
    for (const [severity, heading, symbol] of [['warning', 'Warnings', '!'], ['error', 'Errors', 'x']] as const) {
      const issues = report.diagnostics.filter(issue => issue.severity === severity);
      if (!issues.length) continue;
      console.log(`\n${heading}:`);
      for (const issue of issues) {
        console.log(`  ${symbol} ${issue.message}`);
        if (issue.suggestion) console.log(`    ${issue.suggestion}`);
      }
    }
    if (report.skippedChecks.length) {
      console.log('\nSkipped checks:');
      for (const { check, reason } of report.skippedChecks) console.log(`  - ${check}: ${reason}`);
    }
    console.log(report.status === 'valid' ? '\n+ Pack is valid' : `\nValidation ${report.status}.`);
  }
  if (report.status !== 'valid') process.exit(report.status === 'invalid' ? 1 : 2);
}
