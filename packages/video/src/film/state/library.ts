import type {LibraryDocumentEditorState, LibrarySurfaceState} from '../../agentbuddy-ui/library/libraryTypes';

export const librarySurfaceState: LibrarySurfaceState = {
  breadcrumbs: [
    {id: 'launch', name: 'Launch Film'},
    {id: 'references', name: 'References'},
  ],
  currentFolderId: 'references',
  items: [
    {
      children: [
        {
          id: 'doc-positioning',
          kind: 'Markdown',
          name: 'launch-positioning.md',
          selected: true,
          shortCode: 'DOC-184',
          size: '18 KB',
          tags: ['launch', 'positioning'],
          type: 'document',
          updatedAt: '2026-05-25T14:42:00Z',
        },
        {
          id: 'doc-demo-script',
          kind: 'Markdown',
          name: 'demo-script.md',
          shortCode: 'DOC-186',
          size: '11 KB',
          tags: ['film'],
          type: 'document',
          updatedAt: '2026-05-25T13:16:00Z',
        },
      ],
      expanded: true,
      id: 'folder-launch-assets',
      kind: 'Folder',
      name: 'Launch assets',
      size: '--',
      type: 'folder',
      updatedAt: '2026-05-25T14:45:00Z',
    },
    {
      filePath: '/Users/spankyed/Develop/Projects/AgentBuddy/docs',
      id: 'folder-agentbuddy-docs',
      isSymlink: true,
      kind: 'Linked Folder',
      name: 'AgentBuddy docs',
      size: '--',
      type: 'folder',
      updatedAt: '2026-05-24T18:20:00Z',
    },
    {
      id: 'doc-workflows',
      kind: 'Structured document',
      name: 'workflow-blueprint-notes',
      shortCode: 'DOC-177',
      size: '24 KB',
      tags: ['flows', 'reference'],
      type: 'document',
      updatedAt: '2026-05-23T20:35:00Z',
    },
    {
      id: 'doc-pr',
      kind: 'Markdown',
      name: 'pull-request-flow.md',
      shortCode: 'DOC-169',
      size: '9 KB',
      tags: ['code'],
      type: 'document',
      updatedAt: '2026-05-23T11:02:00Z',
    },
  ],
  panel: {
    allTags: [
      {count: 4, name: 'launch', tone: 'blue'},
      {count: 3, name: 'film', tone: 'purple'},
      {count: 2, name: 'reference', tone: 'green'},
    ],
    documentsCount: 19,
    foldersCount: 6,
    selectedItem: {
      filePath: '/Launch Film/References/Launch assets/launch-positioning.md',
      id: 'doc-positioning',
      kind: 'Markdown',
      name: 'launch-positioning.md',
      shortCode: 'DOC-184',
      size: '18 KB',
      tags: ['launch', 'positioning'],
      type: 'document',
      updatedAt: '2026-05-25T14:42:00Z',
    },
  },
  selectedItemIds: ['doc-positioning'],
  sortBy: 'name',
  sortDirection: 'asc',
};

export const libraryDocumentEditorState: LibraryDocumentEditorState = {
  availableTags: [
    {name: 'launch', color: '#3b82f6'},
    {name: 'positioning', color: '#a855f7'},
    {name: 'reference', color: '#22c55e'},
    {name: 'film', color: '#f59e0b'},
  ],
  document: {
    id: 'doc-positioning',
    name: 'launch-positioning.md',
    shortCode: 'DOC-184',
  },
  name: 'launch-positioning.md',
  sections: [
    {
      text: '# AgentBuddy launch positioning\n\nAgentBuddy turns conversations, notes, code, workflows, logs, and memory into one working surface.\n\nUse the film to show real work moving across plugins without leaving context.',
      type: 'markdown',
    },
    {
      fields: [
        {key: 'Audience', value: 'builders running product + engineering work'},
        {key: 'Promise', value: 'conversation becomes execution'},
        {key: 'Tone', value: 'calm, precise, launch-quality'},
      ],
      type: 'field',
    },
    {
      items: ['Show source-backed UI surfaces', 'Avoid fake status UI', 'Keep workflows as blueprints'],
      type: 'list',
    },
  ],
  tags: ['launch', 'positioning'],
};
