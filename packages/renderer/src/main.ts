import { windowPerformance, startStartupRecording } from './runtime/performance.ts';
import { hostDeclaration } from '@apackdev/host/fe';
import { createApp } from 'vue'
import { createActor } from 'xstate';
// import { createBrowserInspector } from '@statelyai/inspect';
import type { Actor } from 'xstate';
import App from './views/App.vue'
import './style.css'
import './boot/monaco';
// highlight.js's stylesheet is global (.hljs, pre code.hljs), so the app owns it: imported from
// @apackdev/ui it would ship again inside every build.bundleUi pack and restyle code everywhere.
import 'highlight.js/styles/github-dark.css'
import { hostFrontend } from '@/views/packs/surface';
import { createAppShell } from '@/runtime/shell';
import { HOST, installFromProtocol, runWindowStorageMigrations } from '@apackdev/host/fe';
import 'virtual:host-shared-modules';
import { bindRendererHost } from '@/runtime';
import { fePacks } from '@/runtime/packs';
import { handleVueError, installGlobalErrorHandling, reportRendererError } from '@/boot/errors';
import { untypedSendToSystem } from '@apackdev/sdk/events';

declare const __APP_VERSION__: string;

declare global {
  interface Window {
    applicationState: Actor<ReturnType<typeof createAppShell>>;
    __disableOnboardingUI?: () => void;
    /**
     * Sends a backend system an event the way a surface does, for the E2E suite.
     *
     * A door of its own, because the suite has no other: a send to a system goes through the API's
     * `bus.send`, which is tRPC over a WebSocket — a client to stand up rather than a call to make — and
     * nothing else in the page exposes one. Borrowing a door that production code needs is what this
     * avoids: such a door is then load-bearing for a test, and removing it breaks the suite for reasons
     * that have nothing to do with it.
     */
    __sendToSystem?: (systemId: string, event: { type: string } & Record<string, unknown>) => void;
    /** Developer/test recording; the authenticated backend refuses production admission. */
    __performance: typeof windowPerformance;
    appVersion: string;
  }
}

installGlobalErrorHandling();

const query = new URLSearchParams(window.location.search);
if (query.has('performanceStartup')) await startStartupRecording(query.get('performanceStartup'));
const isSurfacePopout = query.get('popout') === 'surface';
const initialSurfaceId = isSurfacePopout ? query.get('surfaceId') ?? undefined : undefined;

// --- Pre-actor initialization ---
window.appVersion = __APP_VERSION__;
console.log(`apack v${__APP_VERSION__}`);
runWindowStorageMigrations(localStorage, __APP_VERSION__);

// const { inspect } = createBrowserInspector();

// The only frontend registered before the shell starts. Every *pack's* frontend — the one the app ships
// among them — is loaded by the shell once the bus says which packs are running, through one path.
fePacks.registerPackFE({ kind: 'native', declaration: hostDeclaration }, hostFrontend);

// The SDK's frontend code (lookups, navigation, sends, the secrets client) reaches this window's app from here on:
// bound before the application actor is created, since creating it builds its surfaces' state, and before any
// external pack frontend loads
// Read by the binding above before it is assigned below, so `const` would not compile: a const needs its
// initializer, and this one cannot have one until the actor exists. prefer-const misses the closure read.
// eslint-disable-next-line prefer-const
let createdApplication: typeof applicationState | undefined;
bindRendererHost(() => createdApplication);

// The shell starts with the surfaces registered above, its default the one a pack claims
export const applicationState = createActor(createAppShell(), {
  systemId: HOST.application,
  // inspect,
  input: {
    initialSurfaceId,
    ownsLastActiveSurface: !isSurfacePopout,
  }
});

createdApplication = applicationState;
windowPerformance.withinStartup(() => applicationState.start());

window.applicationState = applicationState;

window.__disableOnboardingUI = () => {
  applicationState.send({ type: 'ONBOARDING_COMPLETE' });
  console.log('Onboarding UI hiding disabled');
};

window.__sendToSystem = untypedSendToSystem;
window.__performance = windowPerformance;

applicationState.subscribe({
  error: (error: unknown) => {
    console.error('Application State Error:', error);
    reportRendererError('application-state', error);
    window.__showErrorPage?.(
      'Something went wrong',
      error instanceof Error ? error.stack || error.message : String(error)
    );
  }
});

// Listen for deep link protocol actions (apack://install?pack=...)
window.electronAPI?.protocolAction?.onAction(({ action, params }) => {
  if (action === 'install') installFromProtocol(params);
});

const app = createApp(App);

app.config.errorHandler = (err, _instance, info) => {
  handleVueError(err, info);
};

app.mount('#app');

window.electronAPI?.rendererReady?.();

// External pack FE extensions load from the application actor, each time this window's bus
// subscription is established: a failed query is retried on the next connection.
