import { windowPerformance, startStartupRecording } from './runtime/performance.ts';
import {
  hostDeclaration,
  installFromProtocol,
  provideHostState,
  runWindowStorageMigrations,
  type ShellRuntime,
} from '@apackdev/host/fe';
import { createApp } from 'vue'
import App from './views/App.vue'
import './style.css'
import './boot/monaco';
// highlight.js's stylesheet is global (.hljs, pre code.hljs), so the app owns it: imported from
// @apackdev/ui it would ship again inside every build.bundleUi pack and restyle code everywhere.
import 'highlight.js/styles/github-dark.css'
import { hostFrontend } from '@/views/packs/surface';
import { createAppShell } from '@/runtime/shell';
import 'virtual:host-shared-modules';
import { bindRendererHost, onRendererDispose } from '@/runtime';
import { fePacks } from '@/runtime/packs';
import { handleVueError, installGlobalErrorHandling, reportRendererError } from '@/boot/errors';
import { e2eSystems, type E2eSystems } from '@/transport/e2e-door';

declare const __APP_VERSION__: string;

declare global {
  interface Window {
    applicationState: ShellRuntime;
    __disableOnboardingUI?: () => void;
    /** The E2E suite's sends and asks to the backend's systems (`transport/e2e-door.ts`) */
    __e2eSystems?: E2eSystems;
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
export const applicationState = createAppShell({
  initialSurfaceId,
  ownsLastActiveSurface: !isSurfacePopout,
});

createdApplication = applicationState;
windowPerformance.withinStartup(() => applicationState.start());
onRendererDispose(() => applicationState.stop());

window.applicationState = applicationState;

window.__disableOnboardingUI = () => {
  applicationState.send({ type: 'ONBOARDING_COMPLETE' });
  console.log('Onboarding UI hiding disabled');
};

window.__e2eSystems = e2eSystems;
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
provideHostState(app, applicationState.system);

app.config.errorHandler = (err, _instance, info) => {
  handleVueError(err, info);
};

app.mount('#app');
onRendererDispose(() => app.unmount());

window.electronAPI?.rendererReady?.();

// External pack FE extensions load from the application actor, each time this window's bus
// subscription is established: a failed query is retried on the next connection.
