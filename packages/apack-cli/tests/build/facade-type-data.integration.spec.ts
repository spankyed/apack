// @slow: two real producer/consumer builds and compiler completion suites with poisoned dependency execution.
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/pack-format';
import { facadeSuite } from '../_support/facade-packs';

// Actual producer/consumer builds and editor queries; executable dependency files are poisoned.
facadeSuite('unstamped dependency type data', false, { format: undefined, sdkVersion: '99.0.0' });
facadeSuite('different dependency type-data stamp', false, { format: PACK_SNAPSHOT_FORMAT + 1, sdkVersion: '99.0.0' });
