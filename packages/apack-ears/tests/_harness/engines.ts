// The harness's engines: over the two types its workload writes, and with a sink that can refuse a commit
import { createEarsEngine, type PersistenceSink } from '../../src/index.ts';

const TYPES = new Set(['Task', 'Note']);

export const newEngine = (persistence: PersistenceSink) =>
  createEarsEngine({ persistence, isEntityType: (name) => TYPES.has(name), isRelationKind: () => true, isRole: () => true });

/** A sink that refuses the next unit it is asked to commit when told to, as a full disk would, and otherwise passes on */
export function refusable(sink: PersistenceSink): { sink: PersistenceSink; refuseNext: () => void } {
  let refusing = false;
  return {
    refuseNext: () => { refusing = true; },
    sink: {
      ...sink,
      onUnitEnd(options) {
        if (refusing) {
          refusing = false;
          // The unit's writes were collected; the sink drops them as a refused transaction would
          sink.onUnitStart();
          throw new Error('disk full');
        }
        sink.onUnitEnd(options);
      },
    },
  };
}
