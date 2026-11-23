**Nx would make the orchestration problems easier to manage. It would leave the compiler’s correctness problems largely unchanged—and could make them harder to diagnose if we layer its caching and scheduling over ours carelessly.**

The important question is whether Nx can **replace existing machinery**, not simply launch it.

| Problem | Likely effect of Nx |
|---|---|
| Repeated preparation between tests | Easier to eliminate |
| Repeated builds inside individual tests | Little direct improvement |
| Incorrect dependency declarations | Easier to inspect and maintain; still possible |
| Native compiler capture | Mostly unchanged; caching introduces another boundary |
| Cancellation and cleanup | Mostly unchanged; invocation must be verified |
| Runner blocking | Not solved by an outer task runner |
| Total workload exceeding four minutes | Helps avoid unnecessary work; cannot remove necessary work automatically |

### 1. Redundant full builds

**Nx helps when the repeated work occurs between independently executable targets.**

For example:

```text
prepare fixture
    ├── inspect declarations
    ├── verify archive
    └── exercise installed app
```

A shared producer can run once, with consumers depending on it. Nx provides task dependencies and output caching for this structure. [Nx task execution](https://nx.dev/docs/getting-started/tutorials/running-tasks), [caching](https://nx.dev/docs/concepts/how-caching-works)

But if a single test does this:

```text
build → inspect → build again → inspect again
```

Nx sees one command. It cannot know whether the second build is redundant or the very behavior under test.

**We would still need to refactor the tests.** Nx makes the resulting producer/consumer structure conventional and easier to operate.

There is a further risk: splitting every scenario into a separate task can repeat setup and process startup. More targets are useful only when they create meaningful selection, reuse or isolation.

### 2. Incorrect dependencies

**Nx gives us a better framework for expressing and inspecting dependencies. It does not establish that those dependencies are complete.**

Its input model supports file sets, environment variables and runtime observations. Its affected execution uses the project graph to avoid unrelated work. [Nx inputs](https://nx.dev/docs/references/inputs), [affected execution](https://nx.dev/docs/concepts/ci-concepts/building-blocks-fast-ci)

That could replace some of our custom configuration and selection logic.

However, our unusual cases still need attention:

- A test reads another package without importing it.
- A fixture consumes the shipped pack’s generated output.
- A compiler reads a temporary file outside the repository.
- A missing file appears later.
- Native loader policy changes.

Those are not all ordinary package-import relationships.

**The improvement is lower maintenance cost for conventional dependencies—not automatic correctness for unconventional ones.** We should preserve our dependency-read checks and conservative treatment of inputs Nx cannot reliably represent.

Also, retaining broad inputs can produce the same slow selection under Nx. A new tool does not automatically make ownership narrower.

### 3. Native compiler capture and OS behavior

**Nx would mostly sit outside this work.**

It can launch our compiler and schedule platform-specific targets. It should not replace the code that:

- Captures compiler installations.
- Observes external inputs.
- Determines native-library ownership.
- Validates output freshness.
- Preserves an incumbent build after refusal.

The main danger is **an outer cache bypassing the inner verification**.

Suppose Nx considers a task unchanged, but Windows loader policy or an external dependency has changed. A cache hit could skip the command that would detect that change.

Nx supports runtime inputs, but we would have to prove that the selected inputs faithfully represent the relevant state. [Nx input configuration](https://nx.dev/docs/references/inputs)

My initial rule would be:

> Disable Nx caching for stateful native acceptance and external temporary-workspace workflows until their cache contract is demonstrated.

That does not disable their existing internal build-integrity checks.

The authoring handoff is particularly important: restoring a small repository handoff directory does not necessarily restore the external workspace and archive it references. We must either preserve and validate that external output correctly or rerun its producer.

### 4. Cancellation and cleanup

**Nx simplifies starting targets; it does not automatically inherit our process-lifetime guarantees.**

We already have owners for worker processes, descendants, cancellation and cleanup. Those should remain inside the invoked command initially.

The pilot must verify:

- Interrupting Nx reaches the existing owner.
- The command waits for cleanup before reporting completion.
- Descendants do not survive cancellation.
- Failure evidence remains available.
- Windows and Unix invocation behave correctly.

One concrete footgun: Nx’s `run-commands` supports `readyWhen`, which can consider a task finished when a matching output string appears rather than when its command exits. That is useful for some development-server arrangements, but inappropriate as proof that an acceptance scenario completed and cleaned up. [Nx executors](https://nx.dev/docs/references/nx/executors)

Likewise, a list of commands defaults to parallel execution unless configured otherwise. We must not accidentally parallelize a sequential scenario.

### 5. Runner-blocking code

**Nx does not fix synchronous work blocking Vitest’s own communication.**

If a Vitest worker spends too long inside synchronous compiler or filesystem work, launching it through Nx changes the outer process—not that worker’s behavior.

The existing remedy remains:

- Identify the blocking phase.
- Use an existing subprocess boundary where practical.
- Preserve necessary in-process instrumentation.
- Verify both assertions and reporting.

Nx can make a troublesome target independently runnable and visible. That helps investigation, but it is not a responsiveness fix.

### 6. A workload exceeding four minutes

**Nx can help us execute less irrelevant work and reuse more valid work. It cannot make necessary cold work disappear.**

This distinction matters for our two targets:

- **Warm incremental performance:** affected selection and caching can help substantially.
- **Cold-result performance:** selection, shared preparation and reduced duplication matter; verdict caching contributes nothing because the tests must execute.

Scheduling also needs care. Nx’s ordinary `--parallel` setting limits concurrent tasks. It is not equivalent to our weighted core reservations: one task may spawn multiple test workers and compiler processes. Nx also supports disabling task parallelism on a machine, but that is a coarser control. [Nx parallel execution](https://nx.dev/docs/kb/run-tasks-in-parallel), [target parallelism](https://nx.dev/docs/references/project-configuration)

So we must test nested resource demand. “Two tasks” does not mean “two cores.”

Distributed execution could shorten wall time, but introduces machines, cost and operational complexity. It should not be the initial answer for this single-developer workflow.

### Would adoption make our overall job easier?

**Potentially yes—if we retire custom generic orchestration. Potentially harder—if we retain two competing systems.**

A sensible ownership split would be:

| Nx owns | apack retains |
|---|---|
| Project/task graph and affected selection | Pack compiler capture and freshness |
| Generic task dependencies | Native input admission |
| Proven-safe task caching | Sealed output and archive integrity |
| Top-level task execution | Scenario operation bounds and process cleanup |
| Standard task reporting | Product-specific acceptance assertions |

If Nx simply wraps `npm run chain`, while the chain continues selecting, scheduling and caching everything internally, the benefit is limited and debugging becomes harder.

### What the pilot must establish

Before recommending adoption, I would require:

1. **An ordinary change selects meaningfully less work.**
2. **Shared preparation runs once and missing output is handled correctly.**
3. **External/native state cannot produce an unjustified cache hit.**
4. **Cancellation drains existing owners on Windows and Unix.**
5. **Nested execution respects the resource budget.**
6. **We can identify custom orchestration that will actually be deleted.**

**My assessment: Nx could make the broader cleanup easier, especially selection, configuration and shared preparation. It will not rescue an overgrown test workload by itself.** Its strongest value here would be letting us maintain less generic infrastructure while concentrating our code on apack-specific guarantees.
