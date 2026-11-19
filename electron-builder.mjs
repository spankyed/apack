import pkg from './package.json' with {type: 'json'};
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Arch} from 'electron-builder';
import {createRequire} from 'node:module';
import {APP_WORKSPACES, bundledPackagesFile, readBuildManifest, verifyBuildOutputs, verifyPackagedBuild} from './build/build-metadata.ts';
import {electronNoticesPointer, shipElectronNotices} from './scripts/lib/electron-notices.ts';
import {brokerNoticesFile, sbomIdentity, writeAppNotices} from './scripts/lib/third-party-notices.ts';

/**
 * Electron Builder Configuration
 * Native module rebuilding is handled by build.sh script
 *
 * Set APACK_ENV=beta to build the beta channel app (separate appId + productName
 * so it installs alongside the production app).
 */

const buildRoot = process.env.APACK_BUILD_ROOT;
if (!buildRoot) throw new Error('Packaging requires a completed staging build. Use build:production or build:preview.');
verifyBuildOutputs(buildRoot);
const metadata = readBuildManifest(buildRoot);
const isBeta = metadata.channel === 'beta';
const isPreview = metadata.channel === 'preview';
const {appId, productName, urlScheme} = metadata;
/**
 * The newest glibc any binary the Linux app ships needs: the terminal broker apack-terminal publishes is built on
 * Ubuntu 24.04 and needs 2.39. It is the deb's `libc6` floor, and build-linux.yml fails when it isn't exactly the
 * newest need, so it can't drift from the binaries
 */
const LINUX_GLIBC_FLOOR = '2.39';

/** electron-builder's own deb dependencies, which a set `depends` replaces: read from its FpmTarget, as it reads them */
function debDefaultDepends() {
  const {default: FpmTarget} = createRequire(import.meta.url)('app-builder-lib/out/targets/FpmTarget.js');
  return FpmTarget.prototype.getDefaultDepends('deb');
}

// File names without spaces: GitHub rewrites spaces in release asset names, and
// `apack pack test --channel beta` looks for apack-Beta-<version>-mac-arm64.zip
export const releasePrefix = productName.replace(/ /g, '-');

// Only include speech helpers for the target platform
const speechResources = process.platform === 'win32'
  ? [{ from: 'native/speech/windows/SpeechHelper.ps1', to: 'native/speech/SpeechHelper.ps1', filter: ['**/*'] }]
  : [{ from: 'native/speech/macos/SpeechHelper', to: 'native/speech/SpeechHelper', filter: ['**/*'] }];

export default /** @type import('electron-builder').Configuration */
({
  // Basic configuration
  appId,
  productName,
  extraMetadata: {version: metadata.version},
  afterPack: async (context) => {
    const appDir = context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, `${productName}.app`, 'Contents/Resources/app')
      : path.join(context.appOutDir, 'resources/app');
    verifyPackagedBuild(appDir, buildRoot);
    execFileSync(process.execPath, ['build/prod/verify-node-modules.mjs', appDir], {stdio: 'inherit'});
    // Electron's own notices, which electron-builder deletes on macOS, and there the licenses of the frameworks they
    // don't name (scripts/lib/electron-notices.ts)
    shipElectronNotices({
      platform: context.electronPlatformName,
      appOutDir: context.appOutDir,
      resources: path.join(context.appOutDir, `${productName}.app`, 'Contents/Resources'),
      electronDist: path.join(context.packager.info.projectDir, 'node_modules', 'electron', 'dist'),
      packagedVersion: context.packager.info.framework.version,
      licensesDir: path.join(context.packager.info.projectDir, 'build', 'licenses'),
    });
    // THIRD-PARTY-NOTICES.txt at the app's root: what it carries and inlines (scripts/lib/third-party-notices.ts). A
    // problem fails a production or beta build there, and is reported here on a preview
    const projectDir = context.packager.info.projectDir;
    // The broker built for this platform and arch, named as Node names them, which electron-builder's Arch does for
    // the x64 and arm64 the app is built for
    const broker = brokerNoticesFile(appDir, `${context.electronPlatformName}-${Arch[context.arch]}`);
    const electronVersion = context.packager.info.framework.version;
    // The broker's build is under bin/<commit>/<platform>/, so its directory names the commit it was built from
    const brokerCommit = broker && path.basename(path.dirname(path.dirname(broker)));
    const os = {darwin: 'mac', win32: 'win', linux: 'linux'}[context.electronPlatformName];
    const problems = writeAppNotices({
      appDir,
      buildRoot,
      bundleRecords: APP_WORKSPACES.map(workspace => bundledPackagesFile(buildRoot, workspace)),
      // The built-in pack, whose dist the app ships from the repository
      packDirs: [path.join(projectDir, 'packages', 'default-setup')],
      licensesDir: path.join(projectDir, 'build', 'licenses'),
      channel: metadata.channel,
      platform: context.electronPlatformName,
      native: [
        {pointer: electronNoticesPointer(context.electronPlatformName)},
        {pointer: "elmdb's native binding's: THIRD-PARTY-NOTICES and COPYRIGHT-rust-library.html in node_modules/elmdb", file: path.join(appDir, 'node_modules', 'elmdb', 'THIRD-PARTY-NOTICES')},
        {pointer: "the terminal broker's: THIRD-PARTY-NOTICES and COPYRIGHT-rust-library.html beside it, in node_modules/@app/terminal-broker/bin", file: broker ?? null},
      ],
      // The release's CycloneDX SBOM, beside its installers, which the release workflows upload by the `*.cdx.json` they
      // match. Its arch is electron-builder's name for it (x64, arm64), which the macOS and Windows installers share
      // and the Linux ones don't: the AppImage names x64 x86_64 and the deb amd64 (builder-util's getArtifactArchName)
      sbom: {
        file: path.join(context.outDir, `${releasePrefix}-${metadata.version}-${os}-${Arch[context.arch]}.cdx.json`),
        app: {name: productName, version: metadata.version},
        // The vendored checkouts' packages, by the repository each is pinned from, which no registry publishes
        identity: sbomIdentity(projectDir, {elmdb: 'elmdb#crates/elmdb-node', 'apack-git': 'apack-git', 'apack-terminal': 'apack-terminal#node', 'apack-terminal-view': 'apack-terminal#view'}),
        others: [
          {type: 'framework', name: 'electron', version: electronVersion, purl: `pkg:npm/electron@${electronVersion}`, license: 'MIT'},
          ...(brokerCommit ? [{type: 'application', name: 'apack-terminal', version: brokerCommit, purl: `pkg:github/spankyed/apack-terminal@${brokerCommit}`, license: 'MIT OR Apache-2.0'}] : []),
        ],
      },
    });
    for (const problem of problems) console.warn(`  • third-party notices: ${problem}`);
  },
  directories: {
    output: isPreview ? 'dist/preview' : 'dist',
    buildResources: 'build/resources',
  },
  icon: 'build/resources/icon',
  
  // Build options
  artifactName: `${releasePrefix}-\${version}-\${os}-\${arch}.\${ext}`,
  generateUpdatesFilesForAllChannels: false,
  
  // Platform targets
  mac: {
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/resources/entitlements.mac.plist',
    entitlementsInherit: 'build/resources/entitlements.mac.plist',
    extendInfo: {
      NSMicrophoneUsageDescription: 'apack needs microphone access for voice input.',
      NSSpeechRecognitionUsageDescription: 'apack uses speech recognition to convert voice to text.',
      NSDesktopFolderUsageDescription: 'apack may need access to your Desktop when selecting files.',
      NSNetworkVolumesUsageDescription: 'apack may need to access network volumes to locate development tools.',
      CFBundleURLTypes: [{
        CFBundleURLName: `${productName} Protocol`,
        CFBundleURLSchemes: [urlScheme],
      }],
    },
    notarize: !isPreview && !!process.env.APPLE_TEAM_ID,
    ...(isPreview && {identity: null}),
    target: [
      {
        target: 'dmg',
        arch: ['arm64'] // Only build for Apple Silicon
      },
      {
        target: 'zip',
        arch: ['arm64'] // Only build for Apple Silicon
      }
    ]
  },
  
  dmg: {
    contents: [
      {
        x: 130,
        y: 220
      },
      {
        x: 410,
        y: 220,
        type: 'link',
        path: '/Applications'
      }
    ]
  },
  
  win: {
    ...(isPreview && {signAndEditExecutable: false}),
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      }
    ]
  },
  
  // The deb states its glibc floor to apt, on top of electron-builder's own dependencies, which a set `depends` would
  // otherwise replace (FpmTarget's defaults, kept): build-linux.yml reads the floor back from the built deb and holds
  // every binary in the app to it (build/prod/glibc-floor.sh)
  deb: {depends: [...debDefaultDepends(), `libc6 (>= ${LINUX_GLIBC_FLOOR})`]},

  linux: {
    target: [
      {
        target: 'AppImage',
        arch: ['x64']
      },
      {
        target: 'deb',
        arch: ['x64']
      }
    ],
    category: 'Development'
  },
  
  // Native modules configuration
  npmRebuild: false, // Nothing to rebuild: elmdb is N-API, and the terminal's native half is the broker, a binary of its own
  nodeGypRebuild: false, // Use npmRebuild instead
  
  // Files configuration
  files: [
    'LICENSE*',
    pkg.main,
    'packages/**/*',
    'node_modules/**/*',
    '!**/test/**',
    // **Every license and notice file ships**, the root's and each dependency's, which their licenses ask a
    // redistribution to carry. Nothing excludes `LICENSE*`, and since matching is case-sensitive, the Markdown
    // exclusion spares license, licence, notice and copying files in any case: some packages have their license
    // only as Markdown, esbuild's `LICENSE.md` and `@tiptap/pm`'s `THIRD_PARTY_LICENSES.md` among them
    // (packaged-app-files.spec.ts)
    '!**/!(*[Ll][Ii][Cc][Ee][Nn][CcSs][Ee]*|*[Nn][Oo][Tt][Ii][Cc][Ee]*|*[Cc][Oo][Pp][Yy][Ii][Nn][Gg]*).md',
    '!**/.git',
    '!**/*.map',
    '!**/*.d.ts.map',
    '!**/*.ts',
    '!**/*.tsx',
    '!**/.env',
    '!**/.env.*',
    '!**/tsconfig.json',
    '!**/tsconfig.*.json',
    '!**/vite.config.*',
    '!**/tailwind.config.*',
    '!**/postcss.config.*',
    '!**/rollup*.config.*',
    '!**/scripts/**',
    '!**/.turbo/**',
    '!**/.claude/**',
    '!**/local_cache/**',
    '!packages/*/src/**',
    '!packages/renderer/public/**',
    // Include compiled output
    'packages/*/dist/**',
    ...APP_WORKSPACES.map(name => `!packages/${name}/dist/**`),
    // ...but not the tree each publishable package stages for npm (stagePublishTree): a second copy of the same
    // dist, which the app never loads — it resolves @apackdev/sdk through node_modules to packages/apack-sdk/dist.
    // electron-builder reads no .gitignore, so ignoring it there was not enough: 'packages/**/*' above took it.
    '!packages/*/publish/**',
    // ...nor a pack's working directory. `apack pack build` keeps its dependency cache, its staging, its release
    // output and its record of what each bundling phase read in `.apack/` (PACK_READS_FILE,
    // @apackdev/host/build/pack-workdir), none of which the app loads — and `packages/**/*` above took all of
    // it, dotted directories and all, because electron-builder reads no .gitignore either.
    '!packages/*/.apack/**',
    // The CLI's scaffold templates, which are .ts and .vue files it reads at run time rather than code the
    // app loads — so the exclusions above would strip every one of them and `apack pack init` from the CLI this
    // app installs (bin/app-launcher.sh) would scaffold nothing. Last match wins, so this comes after them.
    'packages/apack-cli/dist/package/templates/**',
    // Include API's local node_modules
    'packages/api/node_modules/**/*',
    // Exclude dev tool output
    '!**/node_modules/.bin',
    '!**/node_modules/@types/**',
    '!**/node_modules/**/docs/**',
    '!**/node_modules/**/CHANGELOG*',
    '!**/node_modules/**/.eslintrc*',
    // elmdb is linked from a checkout of its repository, so its crate sits beside what it publishes (its package.json
    // `files`: index.js, the protocol and the binding); only what it publishes ships
    '!**/node_modules/elmdb/{src,target}/**',
    '!**/node_modules/elmdb/{build.rs,Cargo.toml}',
    '!**/node_modules/elmdb/protocol/*.js',
    ...APP_WORKSPACES.map(name => ({
      from: path.join(buildRoot, 'packages', name, 'dist'), to: `packages/${name}/dist`, filter: ['**/*'],
    })),
  ],

  // Disable ASAR — API server runs as a separate child process (spawn + ELECTRON_RUN_AS_NODE)
  // which cannot access files inside an ASAR archive. The entire API package (dist + node_modules)
  // must live on the real filesystem.
  asar: false,
  
  // Extra resources
  extraResources: [
    {from: path.join(buildRoot, 'build-manifest.json'), to: 'app/build-manifest.json'},
    ...speechResources,
    // `apack` launcher for "Install 'apack' command in PATH"; runs packages/apack-cli/dist/package
    ...(process.platform === 'darwin'
      ? [{ from: 'packages/apack-cli/bin/app-launcher.sh', to: 'cli/apack' }]
      : []),
  ],
  
  // Publishing: enable with PUBLISH_TO_GITHUB=true
  publish: !isPreview && process.env.PUBLISH_TO_GITHUB === 'true' ? {
    provider: 'github',
    owner: 'spankyed',
    repo: 'apack',
    releaseType: isBeta ? 'prerelease' : 'draft',
    ...(isBeta && { channel: 'beta' }),
  } : null
});
