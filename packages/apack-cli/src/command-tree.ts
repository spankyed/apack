type Handler = (args: string[]) => Promise<void>;
export interface Command {
  description: string;
  usage?: string;
  load?: () => Promise<Handler>;
  detailedHelp?: boolean;
  children?: Record<string, Command>;
}

/** Routing and help share the same explicit app/pack command tree. */
export const COMMANDS = {
  'install': { usage: '[version] [--replace] [--channel production|beta] [--relaunch]', description: 'Install the app; production by default', load: async () => (await import('./commands/install')).install, detailedHelp: true },
  'upgrade': { usage: '[version] [--channel production|beta] [--force] [--relaunch]', description: 'Upgrade an installed app', load: async () => (await import('./commands/upgrade')).upgrade, detailedHelp: true },
  'uninstall': { usage: '[--channel production|beta]', description: 'Uninstall the app; keep user data', load: async () => (await import('./commands/uninstall')).uninstall, detailedHelp: true },
  'open': { usage: '[--channel production|beta|preview]', description: 'Open the installed app', load: async () => (await import('./commands/open')).open, detailedHelp: true },
  'logs': { usage: '[--channel production|beta|preview] [--follow] [--lines <count>]', description: 'Read recent app logs or follow new output', load: async () => (await import('./commands/logs')).logs },
  'status': { usage: '[--channel production|beta|preview] [--json]', description: 'Show installed app version, state, and paths', load: async () => (await import('./commands/status')).status },
  'doctor': { usage: '[--channel production|beta|preview] [--json]', description: 'Check the installed app; production by default', load: async () => (await import('./commands/doctor')).doctor, detailedHelp: true },
  'db': { usage: '<command> [options]', description: 'Query, export, import, or reset app data', load: async () => (await import('./commands/db')).db, detailedHelp: true },
  'profiles': { usage: '[command] [options]', description: 'Manage app data directories and profiles', load: async () => (await import('./commands/profiles')).profiles, detailedHelp: true },
  pack: {
    description: 'Author, build, test, and manage packs',
    children: {
      'init': { usage: '[name]', description: 'Scaffold a new pack', load: async () => (await import('./commands/init')).init },
      'add': { usage: '<entity> [options]', description: 'Add a feature, step, action, or other pack entity', load: async () => (await import('./commands/add')).add, detailedHelp: true },
      'generate-entries': { usage: '[--force]', description: 'Generate manifest entry files', load: async () => (await import('./commands/generate-entries')).generateEntries },
      'fetch-deps': { usage: '', description: 'Fetch dependency type manifests', load: async () => (await import('./commands/fetch-deps')).fetchDeps },
      'build': { usage: '[--watch] [--skip-generate] [--skip-fe] [--release]', description: 'Build the pack into dist/', load: async () => (await import('./commands/build')).buildCommand },
      'export': { usage: '[--out <dir>]', description: 'Write an installable pack archive and checksum', load: async () => (await import('./commands/archive')).exportPack, detailedHelp: true },
      'release': { usage: '[patch|minor|major|publish] [options]', description: 'Release a pack', load: async () => (await import('./commands/release')).release, detailedHelp: true },
      'validate': { usage: '[--json]', description: 'Validate the manifest and types', load: async () => (await import('./commands/validate')).validate },
      'facade-report': { usage: '[--update] [--skip-generate] | --from-build', description: 'Check or update the pack facade report', load: async () => (await import('./commands/facade-report')).facadeReport },
      'install': { usage: '<source> --host <path|beta> [--profile <name>]', description: 'Install a pack into an app', load: async () => (await import('./commands/pack-install')).install, detailedHelp: true },
      'replace': { usage: '<id> <source> [--profile <name>]', description: 'Replace a named pack; use user-managed updates', load: async () => (await import('./commands/pack-replace')).replace },
      'restore': { usage: '<id> --host <path|beta> [--profile <name>]', description: 'Restore an app-shipped pack; use app-managed updates', load: async () => (await import('./commands/pack-restore')).restore },
      'uninstall': { usage: '<id> [--profile <name>]', description: 'Remove an installed pack', load: async () => (await import('./commands/pack-uninstall')).uninstall },
      'upgrade': { usage: '<id> [--profile <name>]', description: 'Upgrade an installed pack to a compatible GitHub release', load: async () => (await import('./commands/pack-upgrade')).upgrade },
      'outdated': { usage: '[--profile <name>] [--json]', description: 'Check installed packs for compatible GitHub releases', load: async () => (await import('./commands/pack-outdated')).outdated },
      'list': { usage: '[--profile <name>] [--json]', description: 'List installed packs', load: async () => (await import('./commands/list')).list },
      'dev': { usage: '[--host <path|beta>] [profile flags]', description: 'Build, install, and watch this pack in an app', load: async () => (await import('./commands/dev')).dev, detailedHelp: true },
      'drive': { usage: '[script|--eval <body>|--query <code>|--state] [options]', description: 'Drive an app with this pack as the subject', load: async () => (await import('./commands/drive')).packDrive, detailedHelp: true },
      'test': { usage: '[--host <path|beta>] [--contract] [--release] [--prebuilt] [runner args...]', description: 'Run this pack’s tests', load: async () => (await import('./commands/test')).test, detailedHelp: true },
      'init-tests': { usage: '', description: 'Scaffold pack test configurations', load: async () => (await import('./commands/init-tests')).initTests },
      'info': { usage: '[--json]', description: 'Show the pack manifest and build summary', load: async () => (await import('./commands/info')).info },
      'doctor': { usage: '[--json]', description: 'Check pack source and manifest health', load: async () => (await import('./commands/pack-doctor')).doctor },
      'clean': { usage: '', description: 'Remove this pack’s generated files and build output', load: async () => (await import('./commands/clean')).clean, detailedHelp: true },
    },
  },
  cache: {
    description: 'Manage downloaded app builds',
    children: {
      clean: { usage: '[--all]', description: 'Remove cached beta builds; keep the newest unless --all', load: async () => (await import('./commands/cache-clean')).cacheClean, detailedHelp: true },
    },
  },
} satisfies Record<string, Command>;

function help(command: Command, words: string[]): void {
  const name = ['apack', ...words].join(' ');
  console.log(`Usage: ${name}${command.children ? ' <command>' : command.usage ? ` ${command.usage}` : ''}\n\n${command.description}`);
  if (command.children) {
    console.log('\nCommands:');
    for (const [key, child] of Object.entries(command.children)) console.log(`  ${key.padEnd(20)} ${child.description}`);
  }
  if (command.children) console.log(`\nUse ${name} <command> --help for command help.`);
}

export async function runCommand(args: string[]): Promise<void> {
  let command: Command = { description: 'apack — app and pack CLI', children: COMMANDS };
  const words: string[] = [];
  let rest = args;
  while (command.children) {
    const name = rest[0];
    if (!name || name === '--help' || name === '-h') return help(command, words);
    const child = command.children[name];
    if (!child) throw new Error(`Unknown command: ${['apack', ...words, name].join(' ')}. Use ${['apack', ...words].join(' ')} --help.`);
    words.push(name);
    command = child;
    rest = rest.slice(1);
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    if (!command.detailedHelp) return help(command, words);
    rest = rest.map(arg => arg === '-h' ? '--help' : arg);
  }
  if (command.usage === '' && rest.length) throw new Error(`Usage: apack ${words.join(' ')}`);
  await (await command.load!())(rest);
}
