import { createBuildOutputs } from '../build/build-outputs.ts';
import { writePackBuildInputs, PACK_BUILD_INPUTS_FILE } from '@apackdev/host/build/pack-build-inputs';
import { _packEntityTypes, _packRelationTypes, _packRoles } from '@apackdev/sdk/framework';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  compilePack,
  buildPackConfigFromManifest,
  PACK_TYPES_FACADE,
  GENERATED_ENTITY_DESTINATIONS_FILE,
  GENERATED_EVENT_CONTRACTS_FILE,
  PACK_SNAPSHOT_FORMAT,
  entitiesWithoutShapes,
  CONTENT_COMPILERS_FILE,
  WORKERS_DIR,
  _buildProvenance,
  parseSnapshot,
  compileHelp,
  _declarationRevision,
  type CompilePackOptions, type PackConfig, type PackSnapshot, type PackTypeManifest, type ContentDependency,
} from '@apackdev/sdk/build';
import { findFEEntry, bundlePackFE } from '../build/fe-bundler';
import { apackScope, dslInputsHash, typesInputsHash, readPhaseCache, reuseProblem, takeForward, writeStamps, type PhaseStamp } from '../build/phase-cache';
import { refusePackRuleViolations } from '../build/pack-rules.ts';
import { bundlePackRuntime, bundlePackContentCompilers, bundlePackContentRuntime, bundlePackStepBuild, bundlePackWorkers, CONTENT_RUNTIME_FILE } from '../build/be-bundler';
import { buildReads } from '../build/build-reads';
import { BUILD_INPUTS_IPC_ENV, reportBuildWatchInputs } from '../build/build-watch-inputs.ts';
import { generatedDeclarationProblems } from '../build/generated-declarations.ts';
import { packInputsHash } from '@apackdev/host/build/pack-inputs';
import { captureCompilationInputs } from '../build/compilation-inputs.ts';
import { runPackBuild } from '../build/build-process.ts';
import { withBuildSignals } from '../build/build-signals.ts';
import { bundleDslDefs, monacoDefsFile } from '../build/dsl-defs';
import { bundlePackTypes } from '../build/types-bundler';
import { facadeProblems } from '../build/facade-gate';
import { compareFacadeReport, facadeReportFile, facadeReportText } from '../build/facade-report';
import { bundlePackFlowHelpers } from '../build/flow-helpers-bundler';
import { PACK_LAYOUT, sealPackBuild, readPackBuild } from '@apackdev/host/packs';
import { buildStagingDir, publishPackBuild, type PackBuildCandidate } from '../build/build-publication.ts';
import { withCompilerFileReads } from '@apackdev/host/build/compiler-inputs';
import { createCompilerModuleLoader } from '../build/compiler-modules.ts';
import { holdPackBuildLock } from '../build/build-lock.ts';
import { dependencyTypes, resolveDependencyFiles } from './generate';
import { assertGeneratedCurrent, assertGeneratedStampCurrent, generateEntries, warnStaleDepTypes } from './generate-entries';
import { findPackRoot, readValidManifest, sdkVersion } from '../utils';

/**
 * Public builds refresh linked packages before a fresh worker loads compiler modules.
 * Development startup and watched builds use the same runner without recursive command dispatch.
 */
export async function buildCommand(args: string[]): Promise<void> {
  const unknown = args.filter(arg => !['--watch', '--skip-generate', '--skip-fe', '--release'].includes(arg));
  if (unknown.length) throw new Error(`Unknown build option: ${unknown.join(', ')}. Use apack pack build --help.`);
  const root = findPackRoot(process.cwd());
  if (args.includes('--watch')) {
    if (args.length !== 1) throw new Error('--watch cannot be combined with other build flags');
    const { watchPackBuild } = await import('../build/watch.ts');
    // `npm run dev` forks this and boots the API against the runtime it writes, so it waits to be told the
    // first bundle landed. `process.send` is absent for anyone who ran the command themselves
    await watchPackBuild(root, { onFirstBuild: () => process.send?.({ type: 'ready' }) });
    return;
  }
  await withBuildSignals(signal => runPackBuild(root, { args, signal }));
}

export async function build(args: string[], root = findPackRoot(process.cwd())) {
  const staged = buildStagingDir(root);
  // One build of this pack at a time: two share the staging directory above and each clears it first, so the
  // second would wipe the first's half-written tree and both would rename something over `dist`. A build
  // already running is waited for rather than refused — see `build/build-lock.ts`
  const lock = await holdPackBuildLock(root, {
    packId: readValidManifest(root).id,
    what: ['apack pack build', ...args].join(' '),
    onWait: (holder) => console.log(`Waiting for ${holder} to finish...`),
  });
  try {
    publishPackBuild(root, await preparePackBuild(args, root));
  } catch (err) {
    // Whatever failed and wherever, the pack is left with the build it had. Out here rather than beside each
    // `throw` because a phase that fails before the gates are even reached — an invalid manifest, a feature's
    // missing settings file — is the half that would be forgotten
    fs.rmSync(staged, { recursive: true, force: true });
    throw err;
  } finally {
    lock.release();
  }
}

/** Prepare only; the worker's parent owns the lock and publication through process termination. */
export async function preparePackBuild(args: string[], root: string): Promise<PackBuildCandidate> {
  try { return await buildIntoStaging(args, root); }
  catch (error) {
    fs.rmSync(buildStagingDir(root), { recursive: true, force: true });
    throw error;
  }
}

async function buildIntoStaging(args: string[], root: string) {
  // The installer rejects an invalid manifest; don't build (or let CI publish) one
  const inputsHash = packInputsHash(root);
  const manifest = readValidManifest(root);

  // What the last build left reusable, and what this one leaves for the next
  const { stamps, inputs: cachedInputs, integrity: cachedIntegrity } = readPhaseCache(root);
  const nextStamps: Record<string, PhaseStamp> = {};

  // `outputDir` is where every phase below writes; `distDir` is what it becomes, once they have all succeeded
  const distDir = path.join(root, 'dist');
  const outputDir = buildStagingDir(root);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  // Dependencies' step build code, so this pack's flows validate against real step definitions,
  // and their manifests and build dirs, so entries naming their content formats compile with them
  const content = { ...manifest.content?.sources, ...manifest.content?.datasets };
  const dependencyStepModules: string[] = [];
  const dependencies = new Map<string, ContentDependency>();
  const dependencyFiles = await resolveDependencyFiles(root, manifest.dependencies);
  for (const [depId, files] of dependencyFiles) {
    if (files.executionProblem && Object.keys(content).length) throw new Error(`Dependency "${depId}" cannot supply build code: ${files.executionProblem}`);
    const stepsModule = files.buildDir && path.join(files.buildDir, 'steps.build.mjs');
    if (stepsModule && fs.existsSync(stepsModule)) dependencyStepModules.push(stepsModule);
    dependencies.set(depId, { manifest: files.snapshot.manifest, ...(files.buildDir && { buildDir: files.buildDir }) });
  }
  warnStaleDepTypes(root, new Map([...dependencies].map(([depId, dep]) => [depId, dep.manifest.version])));

  const resolvedDependencies = dependencyTypes(dependencyFiles);
  const { depSnapshots } = resolvedDependencies;
  const compilation = captureCompilationInputs(root);
  const outputs = createBuildOutputs(outputDir);
  const modules = createCompilerModuleLoader(compilation);
  const reusePhase = (name: string) => {
    const stamp = stamps[name];
    if (!stamp || !cachedInputs || !cachedIntegrity) throw new Error(`Cannot reuse ${name} without completed build inputs`);
    compilation.retainInputs(cachedInputs);
    takeForward(distDir, outputDir, stamp.files, { hashes: cachedIntegrity.files, recordOutput: outputs.record });
    nextStamps[name] = stamp;
  };
  // What each bundling phase read, for the chain step that builds this pack to be checked against. The
  // phases with no bundler to ask — codegen, the content compilation, feature settings, the pack rules — are
  // absent from the record rather than guessed at
  const reads = buildReads(root, compilation.sourcePath);
  try {
    if (args.includes('--skip-generate')) assertGeneratedCurrent(root, manifest, resolvedDependencies, compilation);
    else await generateEntries([], root, resolvedDependencies, compilation);
    compilation.captureGenerated();

    // Every rule a pack is held to, reported together: an author fixes them in one pass rather than one build
    // each, and the switchable ones say how to allow them (`build/pack-rules.ts`)
    refusePackRuleViolations(root);

    const release = args.includes('--release');
    console.log(`Building pack: ${manifest.name} v${manifest.version}${release ? ' (release)' : ''}`);

    let packConfig: PackConfig | null = null;

    if (Object.keys(content).length > 0) {
      packConfig = await buildPackConfigFromManifest(manifest, root, { dependencyStepModules, dependencies });
    } else {
      console.log('No content.sources or content.datasets in manifest. Skipping content compilation.');
    }

    const packDir = root;
    // One place for a pack's compiled content, whoever ships it: `dist/runtime/content/`, which staging and
    // publishing carry to `runtime/content/` in the installed layout. The app's apply reads that one path
    const contentOutputDir = path.join(outputDir, PACK_LAYOUT.contentDir);
    const snapshotPath = path.join(outputDir, PACK_LAYOUT.snapshot);

    let result: { counts: Record<string, number>; warnings: string[] } | null = null;

    if (packConfig) {
      const options: CompilePackOptions = {
        packDir,
        outputDir: contentOutputDir,
        packConfig,
        importModule: modules.importModule,
        recordOutput: outputs.record,
      };

      result = await withCompilerFileReads({ compilation, outputDirectory: outputDir }, () => compilePack(options));
    } else {
      fs.mkdirSync(contentOutputDir, { recursive: true });
    }

    // Content compiler modules, for dependents' entries naming this pack's formats. A pack whose formats
    // dependents can't compile with isn't built: fail before the snapshot that advertises them
    const contentCompilers = Object.fromEntries(
      Object.entries(manifest.content?.formats ?? {}).flatMap(([name, format]) => (format.compiler ? [[name, format.compiler]] : [])),
    );
    const contentCompilersBundled = Object.keys(contentCompilers).length > 0;
    if (contentCompilersBundled) {
      const bundled = await bundlePackContentCompilers(root, outputDir, contentCompilers, { release, compilation, recordOutput: outputs.record, recordReads: reads?.forPhase('contentCompilers') });
      if (!bundled.success) throw new Error(`Content compiler bundle failed: ${bundled.error}`);
    }

    // Every failed bundle or gate is reported, then fails the build before the snapshot is written:
    // a snapshot advertises output dependents and installs rely on
    const failures: string[] = [];
    const fail = (message: string) => {
      console.error(`\n${message}`);
      failures.push(message.split('\n')[0]);
    };

    // A dependent generates its EntityName from this pack's snapshot and its own direct dependencies'
    // — it never reads a dependency's dependencies. So a snapshot records what this pack can surface,
    // its dependencies' names included, and a chain A → B → C leaves C's names reachable in A without
    // anyone resolving snapshots transitively. A name whose shape A lacks reads as unknown values, which
    // is what an unshaped entity does anyway.
    const depTypeManifests = [...depSnapshots.values()].map((snap) => snap.types);
    const types: PackTypeManifest = {
      entities: Object.fromEntries([...depTypeManifests.flatMap(t => Object.entries(t.entities ?? {})), ...Object.entries(_packEntityTypes(manifest))]),
      relKinds: Object.fromEntries([...depTypeManifests.flatMap(t => Object.entries(t.relKinds ?? {})), ...Object.entries(_packRelationTypes(manifest))]),
      roles: Object.fromEntries([...depTypeManifests.flatMap(t => Object.entries(t.roles)), ...Object.entries(_packRoles(manifest))]),
    };
    // Facade types for dependents: they import this pack's entity shapes, events, services and repositories
    const facades: Record<string, string> = {};
    const packTypesFile = path.join(outputDir, PACK_LAYOUT.typesDir, `${PACK_TYPES_FACADE}.d.ts`);
    const typesHash = typesInputsHash(root, dependencyFiles, compilation);
    const typesStale = reuseProblem(stamps.types, distDir, typesHash)
      ?? (reads && !reads.carry('types') ? 'no reads recorded to carry' : null);
    const packTypes = typesStale === null
      ? (reusePhase('types'),
         console.log('  facade types: unchanged, reused'),
         { success: true as const, content: fs.readFileSync(packTypesFile, 'utf-8') })
      : await bundlePackTypes(root, packTypesFile, { recordReads: reads?.forPhase('types'), compilation, recordOutput: outputs.record });
    if (typesStale !== null && packTypes.success) {
      nextStamps.types = { hash: typesHash, files: [path.join(PACK_LAYOUT.typesDir, `${PACK_TYPES_FACADE}.d.ts`)] };
    }
    const packTypesProblems = packTypes.success ? facadeProblems(root, packTypesFile) : [];
    if (packTypes.success && packTypesProblems.length === 0) {
      facades[PACK_TYPES_FACADE] = packTypes.content;
      // The reviewed report of this facade, held to the bundle in hand — the one moment nothing can be stale
      // about it. A **warning**, not a `fail`: the collected failures below are for output dependents cannot
      // use, and a report that has not caught up is not that. It would also mean a pack author could not start
      // the app until they had rewritten a reviewed report mid-change, where `facade:check` is the gate that
      // says so once — its own chain step, and CI. A pack with no report has nothing to be stale against
      if (fs.existsSync(facadeReportFile(root))) {
        const report = compareFacadeReport(root, facadeReportText(packTypes.content, root, manifest.id));
        if (report.problem) console.warn(`\nWarning: ${report.problem}`);
      }
    } else if (packTypes.success) {
      // Dependents would read these types as `any` or fail to compile against them
      fail(`Pack types aren't usable by packs that depend on this one. The types of what apack.json exposes (entity shapes, events, services, repositories) must check on their own and import only packages dependents have:\n${packTypesProblems.map((p) => `  - ${p}`).join('\n')}`);
    } else {
      fail(`Pack types bundle failed: ${packTypes.error}`);
    }
    // Flow helpers for dependents: their generated flow helpers re-export this pack's
    const flowHelpers = await bundlePackFlowHelpers(root, path.join(outputDir, PACK_LAYOUT.typesDir), {
      release,
      compilation,
      recordModuleReads: reads?.forPhase('flowHelpersModule'),
      recordOutput: outputs.record,
      recordTypeReads: reads?.forPhase('flowHelperTypes'),
    });
    if (!flowHelpers.success) fail(`Flow helpers bundle failed: ${flowHelpers.error}`);
    /**
     * What this pack's whole tree declares, and which pack declares each name.
     *
     * A dependent sees only its direct dependencies' snapshots, so this has to carry the tree rather
     * than just this pack: a dependent of two packs sharing an ancestor receives the ancestor's names
     * through both, and without knowing who declares them reads that as a collision. Every pack depends
     * on the base pack, so that is every diamond. It is also what lets a dependent naming a surface it
     * only reaches transitively be told which pack to depend on, rather than that the surface is unknown.
     */
    const provenance = _buildProvenance([...depSnapshots], { id: manifest.id, manifest });
    const snapshot: PackSnapshot = {
      declarationRevision: _declarationRevision(manifest),
      entityDestinations: JSON.parse(compilation.readFile(path.join(root, GENERATED_ENTITY_DESTINATIONS_FILE))!.toString('utf-8')),
      eventContracts: JSON.parse(compilation.readFile(path.join(root, GENERATED_EVENT_CONTRACTS_FILE))!.toString('utf-8')),
      types, facades, manifest, format: PACK_SNAPSHOT_FORMAT, sdkVersion: sdkVersion(),
      ...(manifest.extensions?.help && { help: compileHelp(root, manifest) }),
      ...(Object.keys(provenance).length > 0 && { provenance }),
      ...(flowHelpers.success && { flowHelpers: flowHelpers.flowHelpers }),
    };
    const finish = async () => {
      // Finish asynchronous loader teardown before validating and sealing the final read-set.
      await modules.dispose();
      // compilation.finish() below re-checks the captured inputs before anything is published.
      try { assertGeneratedStampCurrent(root, manifest, resolvedDependencies, compilation); }
      catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
      if (packInputsHash(root) !== inputsHash) failures.push('Pack inputs changed during the build; retry before publishing');
      failures.push(...generatedDeclarationProblems(root, snapshot.declarationRevision, !args.includes('--skip-fe')));
      const validation = parseSnapshot(snapshot);
      failures.push(...validation.diagnostics.map(issue => issue.message));
      if (failures.length > 0) {
        throw new Error(`Build failed, so no snapshot was written:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
      }
      fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
      const snapshotBytes = JSON.stringify(snapshot, null, 2);
      fs.writeFileSync(snapshotPath, snapshotBytes);
      outputs.record(snapshotPath, snapshotBytes);
      writeStamps(outputDir, nextStamps, outputs.record);
      const inputBytes = writePackBuildInputs(outputDir, await compilation.finish(args));
      outputs.record(path.join(outputDir, PACK_BUILD_INPUTS_FILE), inputBytes);
      outputs.assertCurrent();
      sealPackBuild(outputDir, manifest, snapshot.sdkVersion);
      // Optional diagnostics describe this validated candidate; only the sealed cache authorizes reuse.
      reads?.write();
      // Cleanup can fail too; finish it before replacing the accepted build.
      compilation.dispose();
      return { inputHash: inputsHash, revision: readPackBuild(outputDir).revision };
    };

    console.log(`\nBuild output:`);
    if (result) {
      for (const [type, count] of Object.entries(result.counts)) {
        if (count > 0) console.log(`  ${type}: ${count}`);
      }

      if (result.warnings.length > 0) {
        console.log(`\nWarnings:`);
        for (const w of result.warnings) {
          console.log(`  ! ${w}`);
        }
      }
    }

    // Informational: nothing is rejected, but these entities' fields read as unknown values
    const unshaped = entitiesWithoutShapes(manifest);
    if (unshaped.length > 0) {
      console.log(`\nNote: ${unshaped.length} ${unshaped.length === 1 ? 'entity has' : 'entities have'} no shape declared, so ${unshaped.length === 1 ? 'its' : 'their'} fields read as unknown values: ${unshaped.join(', ')}`);
    }

    // ── Step build facets (for dependents' flow validation) ─────────────
    if (Object.keys(manifest.extensions?.steps ?? {}).length > 0) {
      const stepBuild = await bundlePackStepBuild(root, outputDir, { release, compilation, recordOutput: outputs.record, recordReads: reads?.forPhase('stepBuild') });
      if (stepBuild.success) {
        console.log(`  step build: dist/${PACK_LAYOUT.stepsBuild}`);
      } else {
        fail(`Step build bundle failed: ${stepBuild.error}`);
      }
    }

    // ── Content runtime (for dependents' unit tests) ─────────────────────────
    const contentRuntime = await bundlePackContentRuntime(root, outputDir, { release, compilation, recordOutput: outputs.record, recordReads: reads?.forPhase('contentRuntime') });
    if (contentRuntime.success) {
      console.log(`  content runtime: dist/${PACK_LAYOUT.buildDir}/${CONTENT_RUNTIME_FILE}`);
    } else {
      fail(`Content runtime bundle failed: ${contentRuntime.error}`);
    }

    if (contentCompilersBundled) console.log(`  content compilers: dist/${PACK_LAYOUT.buildDir}/${CONTENT_COMPILERS_FILE}`);

    // ── DSL editor definitions ───────────────────────────────────────────
    if (manifest.extensions?.dsl) {
      const dslScope = apackScope(root);
      const dslHash = 'missing' in dslScope ? null : dslInputsHash(root, dslScope.dirs, dependencyFiles, compilation);
      const dslStale = dslHash === null ? 'scope incomplete'
        : reuseProblem(stamps.dslDefs, distDir, dslHash) ?? (reads && !reads.carry('dslDefs') ? 'no reads recorded to carry' : null);
      const defs = dslStale === null
        ? (reusePhase('dslDefs'),
           console.log('  dsl defs: unchanged, reused'),
           { success: true as const, files: [] as string[] })
        : await bundleDslDefs(root, outputDir, manifest, { recordReads: reads?.forPhase('dslDefs'), compilation, recordOutput: outputs.record });
      if (dslStale !== null && defs.success && dslHash !== null) {
        nextStamps.dslDefs = { hash: dslHash, files: defs.files };
      }
      if (defs.success) {
        const monacoNames = Object.entries(manifest.extensions.dsl).filter(([, entry]) => entry.targets.includes('monaco')).map(([name]) => name);
        if (monacoNames.length) snapshot.dslDefinitions = Object.fromEntries(monacoNames.map(name => [name,
          fs.readFileSync(path.join(outputDir, monacoDefsFile(name)), 'utf8')]));
        for (const file of defs.files) console.log(`  dsl defs: dist/${file}`);
      } else {
        fail(`DSL definitions bundle failed: ${defs.error}`);
      }
    }

    // ── Backend runtime ──────────────────────────────────────────────────
    const runtimeResult = await bundlePackRuntime(root, outputDir, { release, compilation, recordOutput: outputs.record, recordReads: reads?.forPhase('runtime') });
    if (runtimeResult.success) {
      console.log(`  runtime: dist/${PACK_LAYOUT.runtimeEntry}`);
    } else {
      fail(`Runtime bundle failed: ${runtimeResult.error}`);
    }

    // ── Worker entries ───────────────────────────────────────────────────
    const workers = manifest.build?.workers ?? {};
    if (Object.keys(workers).length > 0) {
      const workersResult = await bundlePackWorkers(root, outputDir, workers, { release, compilation, recordOutput: outputs.record, recordReads: reads?.forPhase('workers') });
      if (workersResult.success) {
        for (const name of Object.keys(workers)) console.log(`  worker: dist/${PACK_LAYOUT.runtimeDir}/${WORKERS_DIR}/${name}.cjs`);
      } else {
        fail(`Worker bundle failed: ${workersResult.error}`);
      }
    }

    // ── FE bundling ──────────────────────────────────────────────────────
    const feEntry = args.includes('--skip-fe') ? null : findFEEntry(root);
    if (feEntry) {
      const feOutputDir = path.join(outputDir, PACK_LAYOUT.runtimeDir);
      const feResult = await bundlePackFE({ packDir: root, outputDir: feOutputDir, entryPoint: feEntry, release, compilation, recordOutput: outputs.record,
        recordReads: reads?.forPhase('fe'), onInputs: process.env[BUILD_INPUTS_IPC_ENV] === '1' ? reportBuildWatchInputs : undefined });
      if (feResult.success) {
        console.log(`  fe: dist/${PACK_LAYOUT.feEntry}`);
        if (fs.existsSync(path.join(outputDir, PACK_LAYOUT.feStyles))) {
          console.log(`  fe styles: dist/${PACK_LAYOUT.feStyles}`);
        }
      } else {
        fail(`FE bundle failed: ${feResult.error}`);
      }
    }

    return await finish();
  } finally {
    try { await modules.dispose(); }
    finally { compilation.dispose(); }
  }
}
