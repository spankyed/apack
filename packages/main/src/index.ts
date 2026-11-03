import type {AppInitConfig} from './AppInitConfig.ts';
import {createModuleRunner} from './ModuleRunner.ts';
import {disallowMultipleAppInstance} from './modules/SingleInstanceApp.ts';
import {createWindowManagerModule} from './modules/window-manager/index.ts';
import {terminateAppOnLastWindowClose} from './modules/ApplicationTerminatorOnLastWindowClose.ts';
import {hardwareAccelerationMode} from './modules/HardwareAccelerationModule.ts';
// import {autoUpdater} from './modules/AutoUpdater.js';
import {allowInternalOrigins} from './modules/BlockNotAllowdOrigins.ts';
import {allowExternalUrls} from './modules/ExternalUrls.ts';
import {createApiServer} from './modules/api-server/ApiServer.ts';
import {createDevApiReloader} from './modules/api-server/dev-reloader.ts';
import {createSplashScreen} from './modules/splash-screen/index.ts';
import {createMediaProtocol} from './modules/media-protocol/index.ts';
import {createPackProtocol} from './modules/pack-protocol/index.ts';
import {createSpeechRecognition} from './modules/speech-recognition/index.ts';
import {createMacOSAppMenu} from './modules/MacOSAppMenu.ts';
import {createBrowserModule} from './modules/browser/index.ts';
import {createProtocolHandler} from './modules/ProtocolHandler.ts';
import {app} from 'electron';
import {createPerformanceModule} from './modules/performance/index.ts';
import {initializeMainLogCapture} from './modules/api-server/logger.ts';
import {initAppEnvironment} from './app-environment.ts';


export async function initApp(initConfig: AppInitConfig) {
  initAppEnvironment();
  initializeMainLogCapture();

  // Disable Chromium media features that trigger macOS Apple Music permission prompt
  app.commandLine.appendSwitch('disable-features', 'MediaSessionService,HardwareMediaKeyHandling');

  // Create instances that need to be shared between modules
  const apiServer = createApiServer();
  const splashScreen = createSplashScreen();

  const moduleRunner = createModuleRunner()
    .init(disallowMultipleAppInstance())
    .init(createProtocolHandler())
    .init(hardwareAccelerationMode({enable: true}))
    .init(createMediaProtocol())  // Must register protocol schemes before app ready
    .init(createPackProtocol())   // pack:// protocol for external pack assets
    .init(splashScreen)  // Show splash screen early
    .init(apiServer)
    // After the API it reloads, and a no-op unless `npm run dev` armed it in a development build
    .init(createDevApiReloader(apiServer))
    .init(createSpeechRecognition())
    .init(createPerformanceModule())
    // .init(createWindowManagerModule({initConfig, openDevTools: import.meta.env.DEV}))
    .init(createWindowManagerModule({initConfig, openDevTools: false, apiServer, splashScreen}))
    .init(terminateAppOnLastWindowClose())
    .init(createBrowserModule())
    .init(createMacOSAppMenu())
    // Disable auto-updater until GitHub releases are configured
    // .init(autoUpdater())

    // Security
    .init(allowInternalOrigins(
      new Set(initConfig.renderer instanceof URL ? [initConfig.renderer.origin] : []),
    ))
    .init(allowExternalUrls());

  await moduleRunner;
}
