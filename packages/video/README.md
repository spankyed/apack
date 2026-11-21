# AgentBuddy Video

Remotion-first demo video package.

## OOM Render Fix

Search terms: OOM, heap, Remotion render memory, stale webpack cache.

If a Remotion render that previously worked starts failing with a Node heap OOM,
use this as the known first response. Do not start by refactoring the film or
auditing components. Treat it as a stale Remotion/webpack cache issue first and
clear the local cache:

```sh
rm -rf packages/video/node_modules/.cache
```

Then rerun the same render command, for example:

```sh
npm run video:render
npm run video:render:square
```

If the cache clear does not fix it, retry once with a larger Node heap:

```sh
NODE_OPTIONS=--max-old-space-size=4096 npm run video:render
NODE_OPTIONS=--max-old-space-size=4096 npm run video:render:square
```

The more specific output and component demo notes live in
`src/film/OUTPUTS.md` and `src/agentbuddy-ui/COMPONENT_DEMOS.md`.
