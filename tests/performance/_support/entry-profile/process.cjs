// Loaded by NODE_OPTIONS before application imports, in the owned Electron/API only.
const role = process.type === 'browser' ? 'main'
  : process.argv.some(arg => /(?:^|\/)dist\/server\.js$/.test(arg)) ? 'backend' : undefined;
const directory = process.env.APACK_ENTRY_PROFILE_DIRECTORY;
if (role && directory) {
  const fs = require('node:fs');
  const path = require('node:path');
  const inspector = require('node:inspector');
  const events = path.join(directory, `${role}.jsonl`);
  const mark = (name, attributes = {}) => fs.appendFileSync(events, JSON.stringify({ name, epochMs: performance.timeOrigin + performance.now(), uptimeMs: process.uptime() * 1000, pid: process.pid, ...attributes }) + '\n');
  mark('process-hook-entry');
  const session = new inspector.Session(); session.connect();
  session.post('Profiler.enable'); session.post('Profiler.setSamplingInterval', { interval: 1000 });
  session.post('Profiler.start');
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    mark('profile-stop');
    session.post('Profiler.stop', (error, result) => {
      if (error) mark('profile-error', { error: error.message });
      else fs.writeFileSync(path.join(directory, `${role}.cpuprofile`), JSON.stringify(result.profile));
      session.disconnect();
    });
  };
  process.once('exit', stop);
  if (role === 'main') {
    const childProcess = require('node:child_process');
    const spawn = childProcess.spawn;
    childProcess.spawn = function (file, args, options) {
      const api = args?.some(arg => /(?:^|\/)dist\/server\.js$/.test(arg));
      if (api) mark('api-spawn-request');
      const child = spawn.call(this, file, args, options);
      if (api) {
        mark('api-spawn-return', { childPid: child.pid });
        child.once('spawn', () => mark('api-spawned', { childPid: child.pid }));
      }
      return child;
    };
    require('node:module').syncBuiltinESMExports();
    // Playwright strips NODE_OPTIONS at launch; arm it here for the API child only.
    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --require=${JSON.stringify(__filename)}`;
    const observeElectron = () => {
    mark('electron-observers-attached');
    const { app, ipcMain } = require('electron');
    app.whenReady().then(() => mark('electron-ready'));
    app.on('web-contents-created', (_event, contents) => {
      mark('web-contents-created', { id: contents.id });
      for (const event of ['did-start-loading', 'dom-ready', 'did-finish-load', 'did-stop-loading']) {
        contents.on(event, () => mark(event, { id: contents.id }));
      }
    });
    ipcMain.on('renderer:ready', event => { mark('renderer-ready', { id: event.sender.id }); stop(); });
    app.once('before-quit', stop);
    };
    if (require('electron').app) observeElectron();
    else process.once('loaded', observeElectron);
  } else {
    const write = process.stdout.write;
    let tail = '';
    process.stdout.write = function (chunk, ...args) {
      const result = write.call(this, chunk, ...args);
      tail = (tail + String(chunk)).slice(-1024);
      if (!stopped && tail.includes('WebSocket Server listening')) { mark('api-ready'); stop(); }
      return result;
    };
  }
}
