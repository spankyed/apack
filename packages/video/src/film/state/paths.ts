export type FilmPathState = {
  homeDirectory: string;
  homeDisplayName: string;
  displayPathAliases: Array<{
    displayName: string;
    path: string;
  }>;
};

export type FilmDirectoryState = {
  displayPath: string;
  name: string;
  path: string;
};

export const filmPathState: FilmPathState = {
  homeDirectory: '~',
  homeDisplayName: '~',
  displayPathAliases: [
    {displayName: '~', path: '~'},
  ],
};

export const filmHomeDirectory = filmPathState.homeDirectory;

export function homePath(path: string, state: FilmPathState = filmPathState) {
  return `${state.homeDirectory}/${path.replace(/^\/+/, '')}`;
}

export function displayPath(path: string, state: FilmPathState = filmPathState) {
  for (const alias of state.displayPathAliases) {
    const normalizedPath = alias.path.replace(/\/+$/, '');

    if (!normalizedPath) continue;

    if (path === normalizedPath) {
      return alias.displayName;
    }

    if (path.startsWith(`${normalizedPath}/`)) {
      return `${alias.displayName}${path.slice(normalizedPath.length)}`;
    }
  }

  return path;
}

export function directoryState(path: string, name?: string, state: FilmPathState = filmPathState): FilmDirectoryState {
  const segments = path.split('/').filter(Boolean);

  return {
    displayPath: displayPath(path, state),
    name: name || segments.at(-1) || path,
    path,
  };
}

export function homeDirectoryState(relativePath: string, name?: string, state: FilmPathState = filmPathState) {
  return directoryState(homePath(relativePath, state), name, state);
}

export const filmProjectDirectories = {
  agentBuddy: homeDirectoryState('Develop/Projects/AgentBuddy'),
  clientlabs: homeDirectoryState('Develop/Projects/Clientlabs'),
  launch: homeDirectoryState('Develop/Projects/Launch'),
  supafan: homeDirectoryState('Supafan', 'Supafan'),
};

export const filmProjects = {
  agentBuddy: filmProjectDirectories.agentBuddy.path,
  clientlabs: filmProjectDirectories.clientlabs.path,
  launch: filmProjectDirectories.launch.path,
  supafan: filmProjectDirectories.supafan.path,
};

export const filmExportDirectories = {
  actions: homePath('Exports/AgentBuddy Actions'),
  flows: homePath('Exports/AgentBuddy Flows'),
  library: homePath('Exports/AgentBuddy Library'),
  notes: homePath('Exports/AgentBuddy Notes'),
  prompts: homePath('Exports/AgentBuddy Prompts'),
  threads: homePath('Exports/AgentBuddy Threads'),
};

export const filmSetupPackDirectories = {
  launch: homePath('Develop/Setup Packs/agentbuddy-launch'),
  broken: homePath('Develop/Setup Packs/broken-pack'),
};

export const filmDatabaseBackupDirectory = homePath('Documents/AgentBuddy Backups');
