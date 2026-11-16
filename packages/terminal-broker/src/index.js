// Where the terminal broker the app runs is, asked of the package that holds it.
//
// **A release build pinned by hash, not a build of anything here.** `pin.json` names an apack-terminal commit and
// the SHA-256 of each of its files on each platform the app ships; the install downloads this platform's from
// that commit's release and verifies them into `bin/<commit>/<platform>/` (`scripts/fetch-terminal-broker.mjs`).
// The path carries the commit, so a broker of another commit is never what this answers, and a pin that moved
// without an install answers absence rather than the old binary.
//
// Asked of a package rather than derived from a path because a packaged app resolves it the way it resolves every
// other dependency, and the API's bundle, Electron main, the CLI and the tests all reach it the same way.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pin = require('./pin.json');

/** Node's name for the platform this process runs on, which is how the pin and the release name one */
const PLATFORM = `${process.platform}-${process.arch}`;

/** What the broker's binary is called on this platform */
const BINARY_NAME = process.platform === 'win32' ? 'apack-terminal.exe' : 'apack-terminal';

/** The directory this platform's files of the pinned commit are installed in, whether or not they are there */
function brokerDirectory() {
  return path.join(__dirname, '..', 'bin', pin.commit, PLATFORM);
}

/** Where the binary would be, whether or not it is there: separate so a refusal can say what it looked for */
function brokerBinaryPath() {
  return path.join(brokerDirectory(), BINARY_NAME);
}

/**
 * The broker binary, or `undefined` when it is not installed: this platform has no files in the pin, or the
 * install that would have fetched them has not run since the pin last moved. Every file the pin names for this
 * platform has to be there, since a Windows binary without its ConPTY beside it runs on the system's.
 */
function brokerBinary() {
  const files = pin.files[PLATFORM];
  if (files === undefined) return undefined;
  const directory = brokerDirectory();
  return Object.keys(files).every((file) => fs.existsSync(path.join(directory, file))) ? brokerBinaryPath() : undefined;
}

module.exports = { BINARY_NAME, PLATFORM, brokerBinary, brokerBinaryPath, commit: pin.commit };
