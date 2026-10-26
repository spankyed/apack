// Compiles flow DSL into a private in-memory engine and exports it back, as tooling does: the installed
// engine (if any) is never touched
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { EarsEngine } from '@apackdev/ears';
import { _createTestEngine } from '../../../src/testing/index.ts';
import { compile } from '../../../src/build/compilers/flow-compiler.ts';
import { exportFlowsToDSL } from '../../../src/build/compilers/flow-to-dsl.ts';
import { EARS } from '../../../src/types/entities.ts';
import type { FlowDSL } from '../../../src/build/compilers/flow-types.ts';
import type { StepDefinition } from '../../../src/steps/types.ts';
import { loadCompiledRows } from './load-compiled.ts';

const entityTypes = new Set<string>(Object.values(EARS.Entity));

/** Round trips with `steps`, or, without them, the registered packs' */
export function createRoundTrip(rootFlowRole: string, steps?: StepDefinition[]) {
  let tmpDir: string;
  let engine: EarsEngine;

  return {
    beforeEach() {
      engine = _createTestEngine({ entityTypes: [...entityTypes] });
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-rt-'));
    },
    afterEach() {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
    /** The engine the last round trip compiled into */
    engine: () => engine,
    roundTrip(
      dsl: FlowDSL,
      opts?: { actions?: Map<string, string>; prompts?: Map<string, string> },
    ): FlowDSL {
      const { create } = engine;
      // The actions and prompts the nodes are instances of, before the rows that link to them
      if (opts?.actions) {
        for (const [label, id] of opts.actions) {
          create(EARS.Entity.Action, { id: id as EARS.EntityId }).set('label', label);
        }
      }
      if (opts?.prompts) {
        for (const [label, id] of opts.prompts) {
          create(EARS.Entity.Prompt, { id: id as EARS.EntityId }).set('label', label);
        }
      }
      const compiled = compile(dsl, { ...opts, steps });
      loadCompiledRows(engine, compiled);

      const { filePath } = exportFlowsToDSL(tmpDir, { rootFlowRole, engine: engine, steps }, false);
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    },
  };
}
