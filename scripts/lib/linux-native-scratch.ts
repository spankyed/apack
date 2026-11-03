/** Native fixtures are disposable; their filesystem flushes must not drain persistent build/image writes. */
export const NATIVE_SCRATCH_MIB = 3072;

/** Generic Linux commands retain disk-backed /tmp; focused native cases can request the same bounded scratch. */
export function linuxTestInvocation(args: readonly string[]) {
  const requested = args[0] === '--native-scratch';
  const command = requested ? args.slice(1) : [...args];
  const nativeSuite = command[0] === 'npm' && command[1] === 'run' && command[2] === 'test:native';
  return { command, scratchArgs: requested || nativeSuite
    ? ['--tmpfs', `/tmp:rw,exec,nosuid,nodev,mode=1777,size=${NATIVE_SCRATCH_MIB}m`] : [] };
}
