# Windows worker RPC failure

Focused run 40897144759 at exact source 203ab2c32ce03f533b6382f744b689fe70dbac8a is terminal FAILURE: Linux x64/macOS arm64 passed, Windows x64 failed in host execution. All 122 collected Windows host assertions passed (including both parent-issued publication kills), but Vitest reported an unhandled worker Timeout calling onTaskUpdate. CLI command/binary and verification steps did not run on Windows. Do not call this a complete Windows green.

Raw report and log are retained. The root cause is unisolated. The next controlled workflow source explicitly bounds the host pool to two workers, matching declared APACK_CHAIN_CORES, without changing test/RPC deadlines, assertions or skips. A later success alone would not prove the original timeout's cause. No identical-source rerun is authorized as qualification.
