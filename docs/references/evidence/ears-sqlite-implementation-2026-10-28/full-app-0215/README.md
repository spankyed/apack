# Source app replay at 0215b9fa00

[Run 41377028064](https://github.com/spankyed/apack/actions/runs/41377028064).

The complete replay has 32 passes, one packaged-only exclusion and one failure: the code-surface file-watcher/terminal test fails while removing its temporary directory with ENOTEMPTY. This is a cleanup failure, not the earlier Settings navigation timeout. The original failure remains recorded; the subsequent finalized-role replay is separate evidence.

The minimized receipt preserves the original report hash and public case outcomes. Raw traces, profiles, configuration and logs are omitted. This qualifies the source app scope, not installed signing or production adoption.

Source follow-up: this test sent terminal.CLOSE_TERMINAL and immediately allowed directory removal. The service emits terminal.CLOSED from its PTY onExit callback, so the test now observes that event for its exact terminal before cleanup. This closes a demonstrated lifecycle gap without retries or a longer existing test deadline. The retained failure report does not identify the directory entry recreated during removal, so the historical ENOTEMPTY cause is not conclusively attributed. Disposable app replay must qualify the new wait.
