/** Native fixtures are disposable; their filesystem flushes must not drain persistent build/image writes. */
export const NATIVE_SCRATCH_MIB = 3072;
export const COMPILER_SCRATCH_MIB = 2048;
const COMPILER_STORE = '/compiler-cache';

/** Generic Linux commands retain disk-backed /tmp; focused native cases can request the same bounded scratch. */
export function linuxTestInvocation(args: readonly string[]) {
  const command = [...args];
  const options = new Set<string>();
  while (command[0] === '--native-scratch' || command[0] === '--compiler-scratch') options.add(command.shift()!);
  const nativeSuite = command[0] === 'npm' && command[1] === 'run' && command[2] === 'test:native';
  const scratchArgs = options.has('--native-scratch') || nativeSuite
    ? ['--tmpfs', `/tmp:rw,exec,nosuid,nodev,mode=1777,size=${NATIVE_SCRATCH_MIB}m`] : [];
  if (options.has('--compiler-scratch')) {
    scratchArgs.push('--tmpfs', `${COMPILER_STORE}:rw,exec,nosuid,nodev,size=${COMPILER_SCRATCH_MIB}m`);
    return { command, scratchArgs, compilerStore: COMPILER_STORE };
  }
  return { command, scratchArgs };
}
