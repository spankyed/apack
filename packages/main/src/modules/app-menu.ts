import {Menu, app} from 'electron';
import type {AppModule} from '../AppModule.ts';
import type {MainModuleScope} from '../MainModuleScope.ts';
import {cliCommandName, installCliCommand} from './cli-command.ts';

/** What the template needs to know about this run, so that building one is a function of its inputs */
export interface AppMenuEnvironment {
  appName: string;
  isPackaged: boolean;
}

/**
 * The application menu, which is a different thing on each platform.
 *
 * **On macOS it is the app's whole menu bar**, and the only place some commands exist at all, so it carries
 * them — with Cmd+Q bound to hide and Cmd+Shift+Q to quit, because a terminal full of work is not something
 * to lose to a mistyped Cmd+Q.
 *
 * **Everywhere else no menu bar is drawn**: every window is `frame: false` with the app's own controls
 * (`WindowManager`), so an application menu there contributes nothing a user can see and nothing but global
 * accelerators — which fire wherever focus is, so a terminal cannot refuse them. Electron's *default* menu's
 * are a shell's keys: Ctrl+R reloads the window where a shell searches its history, Ctrl+W closes the window
 * where a shell deletes a word, and Ctrl+C, Ctrl+A, Ctrl+Z and Ctrl+Q are interrupt, line-start, suspend and
 * flow control. So off macOS this is the two accelerators worth having and nothing else, and Electron's
 * default never gets installed (X3 in the terminal integration review).
 *
 * The editing keys need no entry: Chromium runs cut, copy, paste, select-all and undo itself in whatever is
 * focused, and a menu item would only take them from the terminal to do it. App commands are the renderer's
 * focus-aware hotkey map, which can tell a shell from a text field.
 */
export function appMenuTemplate(
  platform: NodeJS.Platform,
  {appName, isPackaged}: AppMenuEnvironment,
): Electron.MenuItemConstructorOptions[] {
  if (platform !== 'darwin') {
    return [
      {
        label: 'View',
        submenu: [
          {role: 'toggleDevTools', accelerator: 'Control+Shift+I'},
          {role: 'togglefullscreen', accelerator: 'F11'},
        ],
      },
    ];
  }

  return [
    {
      label: appName,
      submenu: [
        {role: 'about'},
        {type: 'separator'},
        // Only packaged apps bundle the CLI; source runs use the workspace `apack`
        ...(isPackaged
          ? [
              {
                label: `Install '${cliCommandName()}' command in PATH`,
                click: () => void installCliCommand(),
              },
              {type: 'separator'} as const,
            ]
          : []),
        {role: 'services'},
        {type: 'separator'},
        {
          label: `Hide ${appName}`,
          accelerator: 'CommandOrControl+Q',
          click: () => app.hide(),
        },
        {role: 'hide', accelerator: 'CommandOrControl+H'},
        {role: 'hideOthers'},
        {role: 'unhide'},
        {type: 'separator'},
        {
          label: 'Quit',
          accelerator: 'CommandOrControl+Shift+Q',
          click: () => app.quit(),
        },
      ],
    },
    {role: 'editMenu'},
    {
      label: 'View',
      submenu: [
        {role: 'toggleDevTools'},
        {type: 'separator'},
        {role: 'resetZoom'},
        {role: 'zoomIn'},
        {role: 'zoomOut'},
        {type: 'separator'},
        {role: 'togglefullscreen'},
      ],
    },
    {role: 'windowMenu'},
  ];
}

class AppMenu implements AppModule {
  async enable({app: electronApp}: MainModuleScope): Promise<void> {
    await electronApp.whenReady();

    const template = appMenuTemplate(process.platform, {
      appName: electronApp.getName(),
      isPackaged: electronApp.isPackaged,
    });

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
}

export function createAppMenu() {
  return new AppMenu();
}
