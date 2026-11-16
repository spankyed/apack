import { loader } from '@guolao/vue-monaco-editor';
import { inject, onScopeDispose, shallowRef, type App, type ShallowRef } from 'vue';

type Monaco = typeof import('monaco-editor');
type MonacoResource = () => Promise<Monaco>;
const key = '@apackdev/ui/monaco-runtime';

/** One editor runtime per window, shared with packs through Vue's host application. */
export function provideMonacoRuntime(app: App, load: MonacoResource): void {
  let pending: Promise<Monaco> | undefined;
  app.provide(key, () => pending ??= load());
}

/** Loading belongs to mounted consumers; a retired consumer cannot adopt a late result. */
export function useMonacoRuntime(): { monaco: ShallowRef<Monaco | undefined>; problem: ShallowRef<string | undefined> } {
  const load = inject<MonacoResource>(key);
  if (!load) throw new Error('The application must provide its Monaco runtime before mounting editors');
  const monaco = shallowRef<Monaco>();
  const problem = shallowRef<string>();
  let active = true;
  onScopeDispose(() => { active = false; });
  void load().then(value => {
    if (!active) return;
    // A bundled UI has its own loader; it must receive the same host-owned runtime too.
    loader.config({ monaco: value });
    monaco.value = value;
  }).catch(error => {
    if (active) problem.value = error instanceof Error ? error.message : String(error);
  });
  return { monaco, problem };
}
