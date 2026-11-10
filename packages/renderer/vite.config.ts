import { appBuildOutput } from '../../build/build-metadata.ts'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { delimiter, dirname, resolve } from 'node:path'
import { defineConfig, defaultClientConditions, defaultServerConditions, type Plugin, type Rollup, type ViteDevServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { sharedFeModules } from '@apackdev/host/build/shared-deps'
import { devPackFrontendsModule, discoverDevPackFrontends } from '@apackdev/host/build/discover'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
const packagesRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const rendererSrcDir = fileURLToPath(new URL('./src/', import.meta.url));

/**
 * `virtual:dev-pack-frontends` — the packs whose frontend this window serves from source, and the
 * renderer's own `@/`.
 *
 * **Serving a pack's frontend from source is the whole of what a dev server adds**, and it is what makes a
 * `.vue` edit patch the component: the pack's modules are in the renderer's own graph, so Vite has an
 * accepting importer to stop the update at. A built app has no source to serve, so the map is empty there
 * and every pack's frontend is fetched over `pack://` from the bundle its own `apack pack build` wrote — which
 * is the path a pack takes in production whatever directory it lives in.
 *
 * The map is keyed by pack id and grants no manifest shipping privilege: a pack is in it because its source is on
 * this disk.
 */
function devPackFrontendsPlugin(serving: boolean): Plugin {
  const VIRTUAL_ID = 'virtual:dev-pack-frontends';
  const RESOLVED_VIRTUAL = '\0' + VIRTUAL_ID;
  const packs = serving ? discoverDevPackFrontends(packagesRoot, process.env.APACK_DEV_PACK_DIRS, process.cwd()) : [];
  const virtualContent = devPackFrontendsModule(packs);
  // Those packs' components are in this window's CSS too, and `tailwind.config.ts` is loaded by PostCSS
  // rather than from here, so this is how it is told. **A declaration, not an inference**: it must not read
  // `NODE_ENV` to work out whether a dev server is running (`identity-guard.spec.ts`), and nothing but a
  // serving config writes this.
  process.env.APACK_DEV_PACK_SOURCES = packs.map((pack) => dirname(dirname(dirname(pack.feEntry)))).join(delimiter);
  if (serving) console.log(`[dev-pack-frontends] serving from source: ${packs.map((pack) => pack.id).join(', ') || 'none'}`);

  return {
    name: 'dev-pack-frontends',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (source === VIRTUAL_ID) return RESOLVED_VIRTUAL;

      // The renderer's own `@/`, and only the renderer's: `tsconfig.app.json` maps it to ./src/*. It used to
      // mean "the importer's pack, or the renderer" — a per-importer rule, which is why four bundler configs
      // each had to implement it. Packs name their own modules with `#` subpath imports now, which Node, Vite
      // and esbuild resolve from the pack's own package.json with no help from here.
      if (source.startsWith('@/') && importer) {
        return this.resolve(resolve(rendererSrcDir, source.slice(2)), importer, { skipSelf: true });
      }
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL) return virtualContent;
    },
  };
}

/**
 * The host's shared modules, named to packs by resolution.
 *
 * A pack's frontend has to use *this app's* Vue, SDK and UI kit: two copies of Vue are two reactivity
 * systems and a component that never updates, two copies of the SDK a second, empty registry. So the host
 * serves each of those modules and publishes an import map naming them, and a pack leaves the specifier
 * bare for the browser to resolve here. Resolution doing the sharing is what buys live bindings, and an
 * import of a name the host does not have that fails at link time rather than arriving as `undefined`.
 *
 * **One list, two shapes.** `sharedFeModules` maps every specifier a pack may leave external to the module
 * the host loads for it: the distinct modules become this build's extra entries, and the whole map becomes
 * the document's `imports`. The pack bundler reads the same function, so what a pack leaves bare and what
 * this map names cannot drift apart.
 *
 * **In a build the map names the emitted chunks**, read out of the bundle rather than predicted, with `./`
 * targets because `base` is `./` and a packaged app's document is a `file://` URL.
 *
 * **In dev it names what Vite serves, read out of Vite's own rewrite** of the module below. That is not a
 * shortcut taken over computing them: a module's identity in the browser is its URL, so a target differing
 * by as little as a `?v=` query is a *second copy* of it, and those queries cannot be derived — measured
 * 2026-10-08, this app's deps carried four different `?v=` hashes at once while
 * `depsOptimizer.metadata.optimized` was empty and every URL was live. Transforming the module and reading
 * back the specifiers Vite wrote answers for a pre-bundled dep and a workspace package's `/@fs/…` source
 * alike, and answers with exactly what the renderer's own code imports.
 */
const SHARED_MODULES = sharedFeModules(import.meta.dirname);
/** The distinct modules behind those specifiers — what the host actually has to serve */
const SHARED_ENTRIES = [...new Set(Object.values(SHARED_MODULES))];

/** A rollup input name for a specifier, which is also the chunk's name and so how the bundle is searched */
function entryName(specifier: string): string {
  return `shared-${specifier.replace(/^@/, '').replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

// Two specifiers differing only in punctuation would take one name, and the map would then send one of
// them to the other's chunk. That is the edit this watches for; no current pair collides.
if (new Set(SHARED_ENTRIES.map(entryName)).size !== SHARED_ENTRIES.length) {
  throw new Error('Two shared modules take the same entry name; entryName() has to tell them apart');
}

function hostSharedModulesPlugin(): Plugin {
  /**
   * The module that puts every shared module in *this window's* graph, which is its whole job — it has no
   * runtime effect and the app imports it for two side effects of being in the graph.
   *
   * In **dev** it is what the map is read from: transforming it gives back the URLs Vite serves each module
   * at, and it is also how the dep optimizer learns of them. ProseMirror's canonical modules are explicitly
   * included below: discovering them during the first navigation would trigger a reload and interrupt
   * Electron's initial page load.
   *
   * In **build** each is an entry in its own right, so this adds nothing there.
   */
  const VIRTUAL_ID = 'virtual:host-shared-modules';
  const RESOLVED_VIRTUAL = '\0' + VIRTUAL_ID;
  const indexOf = new Map(SHARED_ENTRIES.map((specifier, i) => [specifier, i]));

  const virtualContent = SHARED_ENTRIES
    .map((specifier, i) => `import * as __m${i} from ${JSON.stringify(specifier)};\nvoid __m${i};`)
    .join('\n') + '\n';

  function mapFromBundle(bundle: Rollup.OutputBundle): Record<string, string> {
    const emitted = new Map<string, string>();
    for (const output of Object.values(bundle)) {
      if (output.type === 'chunk' && output.isEntry) emitted.set(output.name, output.fileName);
    }
    return Object.fromEntries(Object.entries(SHARED_MODULES).map(([specifier, module]) => {
      const file = emitted.get(entryName(module));
      if (file === undefined) throw new Error(`The build emitted no entry chunk for the shared module ${module}; a pack importing ${specifier} would have nothing to resolve to`);
      return [specifier, `./${file}`];
    }));
  }

  /**
   * **Asks again when the pre-bundle moved under it**, which is a recovery rather than a retry-and-hope.
   *
   * Vite throws `ERR_OUTDATED_OPTIMIZED_DEP` when a dep was re-optimised after the answer it is about to
   * give was computed, and its message says what is meant to happen: *"a page reload is going to ask for
   * it."* Every other consumer delegates that to the client — `transformMiddleware` answers 504 so the
   * runtime reloads, `warmupRequest` just returns, because a reload is coming. **The document cannot
   * delegate it**: there is no runtime yet to see a 504, and this request *is* the reload. Serving the page
   * without a map would be worse than failing, since every pack's frontend would then resolve nothing and
   * nothing would say why until someone reloaded by hand.
   *
   * So it waits for the pre-bundle that invalidated the last answer and asks again. Anything that is not
   * that code, the count check below included, still throws on the first go.
   */
  async function mapFromServer(server: ViteDevServer): Promise<Record<string, string>> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await servedMap(server);
      } catch (err) {
        if ((err as { code?: string }).code !== 'ERR_OUTDATED_OPTIMIZED_DEP' || attempt >= 2) throw err;
        const optimizer = server.environments.client.depsOptimizer;
        await optimizer?.scanProcessing;
        await Promise.all((optimizer?.metadata.depInfoList ?? []).map((dep) => dep.processing));
      }
    }
  }

  async function servedMap(server: ViteDevServer): Promise<Record<string, string>> {
    // The specifier itself, not a `/@id/…` URL: unwrapping that prefix is the HTTP middleware's job, and
    // `transformRequest` hands what it is given straight to the resolvers.
    const transformed = await server.transformRequest(VIRTUAL_ID);
    const served = new Map<number, string>();
    for (const [, index, url] of (transformed?.code ?? '').matchAll(/import \* as __m(\d+) from ["']([^"']+)["']/g)) {
      served.set(Number(index), url);
    }
    // Pairing by the variable's own number rather than by position, so this reads what Vite wrote even if
    // it ever reorders. A short answer means the module did not transform, which the map must not paper over.
    if (served.size !== SHARED_ENTRIES.length) {
      throw new Error(`Vite rewrote ${served.size} of ${SHARED_ENTRIES.length} shared imports in ${VIRTUAL_ID}; the import map would leave the rest unresolvable`);
    }
    return Object.fromEntries(Object.entries(SHARED_MODULES).map(([specifier, module]) => [specifier, served.get(indexOf.get(module)!)!]));
  }

  return {
    name: 'host-shared-modules',
    enforce: 'pre',
    resolveId(source) { if (source === VIRTUAL_ID) return RESOLVED_VIRTUAL; },
    load(id) { if (id === RESOLVED_VIRTUAL) return virtualContent; },
    transformIndexHtml: {
      order: 'post',
      async handler(_html, ctx) {
        const imports = ctx.bundle ? mapFromBundle(ctx.bundle) : await mapFromServer(ctx.server!);
        // Ahead of everything, because an import map has to be parsed before the first module script that
        // could resolve against it. A popout window loads this same document, so it inherits the map.
        return [{ tag: 'script', attrs: { type: 'importmap' }, children: JSON.stringify({ imports }, null, 2), injectTo: 'head-prepend' }];
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  base: './',
  build: {
    outDir: appBuildOutput('renderer'),
    modulePreload: false,
    rollupOptions: {
      // Preserve vendor provenance in cancellation stacks without hiding application errors.
      output: { manualChunks: id => id.includes('/node_modules/monaco-editor/') ? 'monaco' : undefined },
      // **Only when building.** Naming `build.rollupOptions.input` also tells the dev server to crawl those
      // entries for dependency discovery in place of index.html, and a bare specifier is not something it
      // can crawl — dev would then discover nothing and pre-bundle nothing.
      ...(command === 'build' && {
        input: {
          index: resolve(import.meta.dirname, 'index.html'),
          ...Object.fromEntries(SHARED_ENTRIES.map((specifier) => [entryName(specifier), specifier])),
        },
        // Each shared module is an entry so that the import map can name it, and what the map promises is
        // its exports. Rollup may otherwise drop an entry's signature when it is also imported internally.
        preserveEntrySignatures: 'exports-only' as const,
      }),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    devPackFrontendsPlugin(command === 'serve'),
    hostSharedModulesPlugin(),
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith('media-'),
        },
      },
    }),
    vueDevTools(),
  ],
  resolve: {
    // Workspace @apackdev/* packages resolve to source (see their package.json exports)
    conditions: ['@apackdev/source', ...defaultClientConditions],
  },
  ssr: { resolve: { conditions: ['@apackdev/source', ...defaultServerConditions] } },
  optimizeDeps: {
    include: [
      ...SHARED_ENTRIES.filter(module => module.startsWith('prosemirror-')),
      'monaco-editor',
      'ghostty-web',
      'xstate',
      '@xstate/vue',
      'lucide-vue-next',
      'reka-ui',
      '@vue-flow/core',
      '@vue-flow/background',
      '@vue-flow/controls',
      'elkjs/lib/elk.bundled.js',
      '@tiptap/core',
      '@tiptap/vue-3',
      '@tiptap/vue-3/menus',
      '@tiptap/starter-kit',
      '@tiptap/pm/state',
      '@tiptap/pm/view',
      '@tiptap/pm/commands',
      '@tiptap/extension-code',
      '@tiptap/extension-link',
      '@tiptap/extension-table',
      '@tiptap/extension-table-row',
      '@tiptap/extension-table-cell',
      '@tiptap/extension-table-header',
      '@tiptap/extension-task-list',
      '@tiptap/extension-task-item',
      '@tiptap/extension-placeholder',
      '@tiptap/extension-color',
      '@tiptap/extension-highlight',
      '@tiptap/extension-image',
      '@tiptap/extension-code-block-lowlight',
      '@tiptap/extension-blockquote',
      '@tiptap/extension-paragraph',
      '@tiptap/extension-horizontal-rule',
      '@tiptap/extension-details',
      'tiptap-markdown',
      'lowlight',
      'vue-arrange',
      '@leeoniya/ufuzzy',
      '@guolao/vue-monaco-editor',
      'vidstack/player',
      'vidstack/player/layouts/default',
      'vidstack/player/ui',
    ]
  },
}))
