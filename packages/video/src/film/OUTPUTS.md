# AgentBuddy Film Outputs

These are the active publishable renders for the Remotion-first launch film. Older experimental names in `packages/video/out` are not current deliverables.

| Variant | Composition | Command | Output |
| --- | --- | --- | --- |
| Landscape | `AgentBuddyFilm` | `npm run video:render` | `packages/video/out/agentbuddy-film-landscape.mp4` |
| Square | `AgentBuddyFilmSquare` | `npm run video:render:square` | `packages/video/out/agentbuddy-film-square.mp4` |

Rules:

- Add a row here before adding a new publishable variant.
- Keep `Composition` values registered in `packages/video/src/Root.tsx`.
- Keep `Output` paths inside `packages/video/out`.
- Do not treat stale experimental renders as current launch deliverables.

## Render Troubleshooting

If a Remotion render starts failing with a Node heap OOM, first clear the local
Remotion/webpack cache and rerun the exact render command:

```sh
rm -rf packages/video/node_modules/.cache
npm run video:render
```

For the square cut, use:

```sh
rm -rf packages/video/node_modules/.cache
npm run video:render:square
```

If clearing the cache does not fix it, retry once with a larger Node heap:

```sh
NODE_OPTIONS=--max-old-space-size=4096 npm run video:render
NODE_OPTIONS=--max-old-space-size=4096 npm run video:render:square
```
