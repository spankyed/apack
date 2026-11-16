// Monaco recovers from its diff range error and cancels pending work when an editor is disposed. The
// app reports every uncaught renderer error as fatal, so unless this filter is registered *before* that
// reporter, the reporter runs first — listeners on one target fire in registration order, and the
// capture flag does not change that for an event dispatched at the target itself.
//
// It therefore lives in its own module rather than in UnifiedMonacoEditor.vue, where it installed on
// the first editor's setup and so always lost the race: the app's composition root
// (`renderer/src/main.ts`) calls this before adding its own listener, and the editor calls it too, so a
// pack that mounts the editor in a host that forgot is still covered.
let installed = false;

/** Recognizes the vendor errors Monaco recovers from, including disposal reported through Vue. */
export function isRecoverableMonacoError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const origin = error.stack?.split('\n').find(line => line.trimStart().startsWith('at ')) ?? '';
  return error.message.includes('cannot be after endLineNumberExclusive')
    || (error.name === 'Canceled' && error.message === 'Canceled'
      && (/\/monaco(?:-editor|-vendor-[A-Za-z0-9_-]+\.js)/.test(origin)));
}

/** Stops recoverable Monaco errors from reaching a global error handler. Safe to call repeatedly. */
export function installMonacoErrorFilters(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event) => {
    if (isRecoverableMonacoError(event.error)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (isRecoverableMonacoError(event.reason)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });
}
