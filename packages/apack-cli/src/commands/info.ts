import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { _packEntities, inspectContentReferences, type ContentIndex } from '@apackdev/sdk/build';
import { PACK_LAYOUT, readPackBuild, type PackBuild } from '@apackdev/host/packs';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { findPackRoot, readValidManifest } from '../utils';
import { inspectDependencies, describeDependency } from '../build/dependency-inspection.ts';

function inspectBuild(root: string, manifest: ReturnType<typeof readValidManifest>): {
  status: 'unbuilt' | 'verified' | 'stale' | 'invalid';
  directory: string;
  problem?: string;
  revision?: string;
  metadata?: { packId: string; declarationRevision: string; format: number; sdkVersion?: string;
    entities: ReturnType<typeof _packEntities>; relations: PackBuild['snapshot']['types']['relKinds']; roles: PackBuild['snapshot']['types']['roles'];
    entityDestinations: PackBuild['snapshot']['entityDestinations']; eventContracts: PackBuild['snapshot']['eventContracts']; facades: string[] };
  content?: ContentIndex;
} {
  const directory = fs.existsSync(path.join(root, PACK_LAYOUT.integrity)) ? root : path.join(root, 'dist');
  if (!fs.existsSync(directory)) return { status: 'unbuilt', directory };
  try {
    const build = readPackBuild(directory);
    const content = build.content;
    const stale = !isDeepStrictEqual(manifest, build.snapshot.manifest);
    return { status: stale ? 'stale' : 'verified', directory, revision: build.revision,
      metadata: { packId: build.snapshot.manifest.id, declarationRevision: build.snapshot.declarationRevision, format: build.snapshot.format,
        sdkVersion: build.snapshot.sdkVersion, entities: _packEntities(build.snapshot.manifest),
        relations: build.snapshot.types.relKinds, roles: build.snapshot.types.roles, entityDestinations: build.snapshot.entityDestinations,
        eventContracts: build.snapshot.eventContracts, facades: Object.keys(build.snapshot.facades) },
      ...(content && { content }), ...(stale && { problem: 'Built declarations differ from the current manifest; rebuild the pack.' }),
    };
  } catch (error) {
    return { status: 'invalid', directory, problem: errorMessage(error) };
  }
}

/** Inspect declarations, verified output and dependencies without importing pack modules or writing files. */
export async function inspectPack(root: string) {
  const manifest = readValidManifest(root);
  const dependencies = await inspectDependencies(root, manifest.dependencies);
  return { root, id: manifest.id, name: manifest.name, version: manifest.version, hostVersion: manifest.hostVersion,
    declared: manifest,
    build: inspectBuild(root, manifest), dependencies: dependencies.entries,
  };
}

export async function info(args: string[]) {
  if (args.some(arg => arg !== '--json')) throw new Error('Usage: apack pack info [--json]');
  const report = await inspectPack(findPackRoot(process.cwd()));
  if (args.includes('--json')) { console.log(JSON.stringify(report)); return; }
  console.log(`Pack: ${report.id} (${report.name})\nVersion: ${report.version}\nHost: ${report.hostVersion ?? 'unrestricted'}\nRoot: ${report.root}`);
  const manifest = report.declared;
  const names = (label: string, entries: object | undefined) => {
    const keys = Object.keys(entries ?? {});
    if (keys.length) console.log(`${label}: ${keys.join(', ')}`);
  };
  console.log(`\nDeclared features (${Object.keys(manifest.features ?? {}).length}):`);
  for (const [id, feature] of Object.entries(manifest.features ?? {})) {
    console.log(`  ${id}${feature.surface ? ` — ${feature.surface.label}` : ''}: ${feature.description}`);
    if (feature.system) console.log(`    System: ${feature.system.entry}`);
    names('    Services', feature.services);
    names('    Repositories', feature.repositories);
    names('    Reference types', feature.references?.types);
    names('    Reference categories', feature.references?.categories);
  }
  for (const [kind, declaration] of Object.entries(manifest.extensions ?? {})) {
    if (kind === 'help') console.log(`Declared help: ${manifest.extensions!.help!.path}`);
    else names(`Declared ${kind}`, declaration);
  }
  if (manifest.consumes?.services.length) console.log(`Required services: ${manifest.consumes.services.join(', ')}`);
  names('Declared lifecycle', manifest.lifecycle);
  names('Declared app migrations', manifest.migrations?.app);
  names('Declared pack migrations', manifest.migrations?.pack);
  const entities = _packEntities(manifest);
  if (entities.length) console.log(`Declared entities: ${entities.map(entity => `${entity.name} (${entity.owner})`).join(', ')}`);
  const relations = Object.keys(manifest.data?.relations ?? {});
  if (relations.length) console.log(`Declared relations: ${relations.join(', ')}`);
  for (const [kind, declaration] of Object.entries(manifest.content ?? {})) names(`Declared content ${kind}`, declaration);
  console.log(`\nBuild: ${report.build.status}${report.build.revision ? `; revision ${report.build.revision}` : ''}`);
  if (report.build.problem) console.log(`  ${report.build.problem}`);
  const metadata = report.build.metadata;
  if (metadata) {
    const destinations = Object.entries(metadata.entityDestinations);
    console.log(`Entity destinations: ${destinations.length ? destinations.map(([entity, feature]) => `${entity} → ${metadata.packId}/${feature}`).join(', ') : 'none'}`);
    console.log(`Event contracts: ${Object.keys(metadata.eventContracts ?? {}).length ? '' : 'none'}`);
    for (const [feature, events] of Object.entries(metadata.eventContracts ?? {})) {
      if (events.system) console.log(`  ${metadata.packId}/${feature} system: receives ${events.system.incoming.join(', ') || 'none'}; sends ${events.system.outgoing.join(', ') || 'none'}`);
      if (events.surface) console.log(`  ${metadata.packId}/${feature} surface: receives ${events.surface.receives.join(', ') || 'none'}`);
    }
  } else {
    console.log('Entity destinations: unavailable (requires a verified build)');
    console.log('Event contracts: unavailable (requires a verified build)');
  }
  if (report.build.content) {
    console.log('Compiled content:');
    for (const entry of report.build.content.entries) {
      console.log(`  ${entry.key}: ${entry.count} item(s)${entry.written ? '' : ' (dataset)'}`);
      for (const item of entry.items) console.log(`    ${item.key}${item.description ? ` — ${item.description}` : ''}`);
      console.log(`    Reference analysis: ${entry.references ? 'static only; computed targets may remain unknown' : 'unavailable'}`);
    }
    for (const reference of inspectContentReferences(report.build.content)) {
      console.log(`  ${reference.source.key}/${reference.source.item} (${reference.path}) → ${reference.target.key}/${reference.target.item ?? '(computed)'} [${reference.status}]`);
    }
    console.log('  Reference targets are checked against compiled inventory, not user data.');
  } else console.log(`Compiled content: ${report.build.status === 'verified' ? 'none' : 'unavailable'}`);
  if (report.dependencies.length) {
    console.log('\nDependencies:');
    for (const dependency of report.dependencies) console.log(`  ${describeDependency(dependency)}`);
  }
}
