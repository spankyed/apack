/**
 * **The devex requirement of [`goal-one-kind-of-pack`](../../../docs/archive/goals/goal-one-kind-of-pack.md): from
 * `npm run dev`, editing a `.vue` in *any* workspace pack patches the component rather than reloading the
 * window.** It outranked every other consideration in that goal, and nothing else here would notice it
 * going: the app would still boot, every pack would still load, and a component edit would quietly start
 * costing the app's state.
 *
 * What makes it true is one structural fact, which is what this asserts: the pack's modules are in the
 * renderer dev server's **own** module graph, so Vite has a self-accepting module with importers to stop the
 * update at. `virtual:dev-pack-frontends` is the mechanism — it statically names each local pack's generated
 * frontend entry, and the entry imports the pack's components. A pack fetched over `pack://` is outside that
 * graph entirely, which is why a component edit there reloads the window instead (measured 2026-10-07, and
 * recorded where `apack pack dev` prints it).
 *
 * The graph is walked from the real entry rather than by requesting the pack's file directly, because what
 * is being checked is that *the page reaches it*: a module transformed on its own is in the graph with no
 * importers, which is not the condition HMR needs and not what a browser does.
 *
 * What is **not** here: which payload Vite then sends. That is Vite's and plugin-vue's behaviour over a
 * self-accepting module, identical for every module in the graph, and asserting it would be testing Vite.
 * The map's own contents — which packs are in it, and why a directory is not — are `@apackdev/host`'s
 * `tests/build/dev-pack-frontends.spec.ts`, where they cost nothing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, normalizePath, type ViteDevServer } from 'vite';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';

/** One pack the app ships, and one that is not in `packages/` at all, reached the same way */
const PACKS = [
  { label: 'the pack the app ships', component: 'packages/default-setup/src/features/notes/fe/canvas.vue' },
  { label: 'a pack outside the workspace', component: 'tests/packs/external-pack/src/features/memos/fe/settings.vue' },
];

let server: ViteDevServer;
let walked = 0;

beforeAll(async () => {
  const external = path.join(REPO_ROOT, 'tests', 'packs', 'external-pack');
  expect(fs.existsSync(path.join(external, 'src', '__generated__', 'pack-entry-fe.ts')),
    'External fixture frontend is missing; run npm run test:external-pack:contract first').toBe(true);
  // How a pack outside `packages/` joins the loop. The workspace packs need no naming.
  // **Absolute**, because the variable is resolved against `process.cwd()` and this suite has two runners:
  // the pooled config from the repo root, and `npm run spec`, which runs it with the package as cwd. A
  // relative path is the repo's from one and names nothing from the other, so the pack went undiscovered
  // and the case read as "its pack is fetched over pack://" — a true sentence about the wrong cause.
  vi.stubEnv('APACK_DEV_PACK_DIRS', external);
  server = await createServer({ mode: 'development', root: path.join(REPO_ROOT, 'packages', 'renderer'), logLevel: 'error' });
  await server.listen();

  // Populate the graph the way a browser loading the page does: from the entry, following every import edge
  // the transforms discover, the pack map's dynamic ones included. Not the files a stylesheet watches:
  // Tailwind records every source it scans (a pack's backend included) as a dependency of `style.css`, a
  // node with no id that a browser never requests, and transforming one hands node-only packages to the
  // browser's dependency optimizer
  const seen = new Set<string>();
  let queue = ['/src/main.ts'];
  for (let depth = 0; depth < 12 && queue.length > 0; depth++) {
    const next = new Set<string>();
    await Promise.all(queue.map(async (url) => {
      if (seen.has(url) || seen.size > 4000) return;
      seen.add(url);
      try {
        await server.transformRequest(url);
        const mod = await server.moduleGraph.getModuleByUrl(url);
        for (const imported of mod?.importedModules ?? []) if (imported.id) next.add(imported.url);
      } catch { /* a module the page would not have reached either */ }
    }));
    queue = [...next];
  }
  walked = seen.size;
});

afterAll(async () => {
  try { await server?.close(); }
  finally { vi.unstubAllEnvs(); }
});

describe('a pack whose source this machine has', () => {
  it('walks a graph, so the cases below are not asking about nothing', () => {
    expect(walked, 'the entry transformed nothing — the dev server config is broken, not the packs').toBeGreaterThan(500);
  });

  it.each(PACKS)('has $label in the renderer\'s own module graph, accepting its own updates', ({ component }) => {
    const file = path.join(REPO_ROOT, component);
    expect(fs.existsSync(file), `${component} is gone — point this at a component that exists`).toBe(true);

    // The component's own module, whose id is the file: a file also has its SFC parts (`?vue&type=style…`)
    // and a file-only node for what watches it (Tailwind's sources), neither of which is what an edit patches
    const mod = [...server.moduleGraph.getModulesByFile(file) ?? []].find((m) => m.id === normalizePath(file));
    expect(mod, `${component} is not in the graph: its pack is fetched over pack://, so editing it reloads `
      + 'the window. APACK_DEV_PACK_DIRS or the workspace scan is what puts it here').toBeDefined();
    // Vite's condition for patching a module instead of reloading the page
    expect(mod!.isSelfAccepting, `${component} is in the graph but does not accept its own updates`).toBe(true);
    expect(mod!.importers.size, `nothing imports ${component}, so an update has no boundary to stop at`).toBeGreaterThan(0);
  });
});
