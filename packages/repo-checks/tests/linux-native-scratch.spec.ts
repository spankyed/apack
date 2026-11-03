import path from 'node:path';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { expect, it } from 'vitest';
import { linuxTestInvocation, NATIVE_SCRATCH_MIB } from '../../../scripts/lib/linux-native-scratch.ts';
import { CHAIN_STEPS, NATIVE_SUITES, suiteInputs } from '../../../scripts/lib/chain-steps.ts';
import { poolUnitFor } from '../../../scripts/lib/unit-pool.ts';

it.each([
  ['npm', 'run', 'test:native'],
  ['npm', 'run', 'test:native', '--', '--all'],
  ['npm', 'run', 'test:native', '--', '--shard=1/2'],
])('gives the maintained native command bounded executable scratch: %j', (...command) => {
  const result = linuxTestInvocation(command);
  expect(result.command).toEqual(command);
  expect(result.scratchArgs[0]).toBe('--tmpfs');
  const options = result.scratchArgs[1]!.split(',');
  expect(options).toContain('/tmp:rw');
  expect(options).toContain('exec');
  expect(options).toContain('mode=1777');
  expect(options).toContain(`size=${NATIVE_SCRATCH_MIB}m`);
  expect(NATIVE_SCRATCH_MIB).toBeLessThanOrEqual(6144 / 2);
});

it.each([
  ['npm', 'run', 'test:performance'],
  ['node', 'test:native'],
  ['npm', 'run', 'benchmark', '--', 'test:native'],
])('keeps generic commands and benchmark data disk-backed: %j', (...command) => {
  expect(linuxTestInvocation(command)).toEqual({ command, scratchArgs: [] });
});

it('lets focused native cases select scratch without forwarding the runner flag', () => {
  const command = ['npx', 'vitest', 'run', 'case.native.spec.ts', '-t', 'one case'];
  expect(linuxTestInvocation(['--native-scratch', ...command])).toEqual({
    command, scratchArgs: linuxTestInvocation(['npm', 'run', 'test:native']).scratchArgs,
  });
  expect(linuxTestInvocation(['--native-scratch']).command).toEqual([]);
});

it('includes the resource policy in outer and per-project native cache inputs', () => {
  const expected = ['scripts/linux-runner.ts', 'scripts/lib/linux-native-scratch.ts', 'scripts/linux/Dockerfile'];
  const native = CHAIN_STEPS.find(step => step.name === 'test:native')!;
  for (const file of expected) expect(native.inputs).toContain(file);
  for (const suite of NATIVE_SUITES) {
    for (const file of expected) expect(suiteInputs(suite, 'native')).toContain(file);
    const unit = poolUnitFor(suite, 'native', 'chain', 1);
    for (const file of expected) expect(unit.inputs).toContain(path.join(REPO_ROOT, file));
  }
});
