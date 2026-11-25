import type { ResolvedContentSource } from './content/resolve.ts';
import type { StepDefinition } from '@apackdev/sdk/steps';
import type { ArtifactDefinition } from '@apackdev/sdk/artifacts';
import type { BlockDefinition } from '@apackdev/sdk/blocks';

/** The step, artifact and block definitions a pack compiles with: its dependencies' and its own */
export interface PackBuildDefinitions {
  steps: StepDefinition[];
  artifacts: ArtifactDefinition[];
  blocks: BlockDefinition[];
}

/** Loads executable pack build code from an absolute module path. */
export type PackModuleLoader = (file: string) => Promise<Record<string, unknown>>;

/** A pack's content sources, as `compilePack` compiles them (built from apack.json by buildPackConfigFromManifest) */
export interface PackConfig {
  name: string;
  /** `content.sources`, each entry resolved to its path, applier, or format settings */
  sources: Record<string, ResolvedContentSource>;
  /** Loads the definitions compiling validates against, such as the step types flows use */
  loadDefinitions?: (importModule?: PackModuleLoader) => Promise<PackBuildDefinitions>;
}

export interface CompilePackOptions {
  packDir: string;
  outputDir: string;
  /** Expected content/media bytes at absolute output paths, retained by the caller until sealing. */
  recordOutput?: (file: string, bytes: string | Uint8Array) => void;
  packConfig?: PackConfig;
  /** The definitions to compile with; the pack config's (`loadDefinitions`) by default, none without one */
  definitions?: PackBuildDefinitions;
  /** Loads executable content, flow and step modules; defaults to native import(). */
  importModule?: PackModuleLoader;
  /** Progress lines (the pack and each key's item count); defaults to console.log */
  log?: (message: string) => void;
}

export interface CompilePackResult {
  /** Items compiled per content key */
  counts: Record<string, number>;
  warnings: string[];
}
