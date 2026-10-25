import pkg from './package.json' with {type: 'json'};
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {APP_WORKSPACES, readBuildManifest, verifyBuildOutputs, verifyPackagedBuild} from './build/build-metadata.ts';

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
// File names without spaces: GitHub rewrites spaces in release asset names, and
// `apack pack test --channel beta` looks for apack-Beta-<version>-mac-arm64.zip
export const releasePrefix = productName.replace(/ /g, '-');

// Exclude prebuilds for platforms we're not targeting
const excludePrebuilds = {
  win32:  ['!**/node-pty/prebuilds/darwin-*'],
  darwin: ['!**/node-pty/prebuilds/win32-*', '!**/node-pty/prebuilds/darwin-x64'],
  linux:  ['!**/node-pty/prebuilds/darwin-*', '!**/node-pty/prebuilds/win32-*'],
}[process.platform] ?? [];

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
  npmRebuild: false, // Selective rebuild in build.sh (lmdb uses NAPI prebuilds, only node-pty needs rebuild)
  nodeGypRebuild: false, // Use npmRebuild instead
  
  // Files configuration
  files: [
    'LICENSE*',
    pkg.main,
    'packages/**/*',
    'node_modules/**/*',
    '!**/test/**',
    '!**/*.md',
    '!**/LICENSE*',
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
    // Exclude platform-specific prebuilds not needed for current target
    ...excludePrebuilds,
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
