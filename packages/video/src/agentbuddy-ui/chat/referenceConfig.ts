import type {LucideIcon} from 'lucide-react';
import {Icons} from '../primitives/Icon';

// Mirrors packages/renderer/src/core/components/tiptap/reference-config.ts.
export type ReferenceCategory = 'threads' | 'documents' | 'notes';
export type ReferenceRefType = 'thread' | 'document' | 'folder' | 'note' | 'task' | 'tasklist';
export type ReferenceSvgElement =
  | ['path', {d: string}]
  | ['rect', Record<string, string>]
  | ['circle', Record<string, string>];

export type ReferenceTypeConfig = {
  category: ReferenceCategory;
  icon: LucideIcon;
  plugin: string;
  protocol: string;
  svgElements: ReferenceSvgElement[];
};

export const REFERENCE_TYPES = {
  thread: {
    protocol: 'thread',
    category: 'threads',
    plugin: 'threads',
    icon: Icons.History,
    svgElements: [
      ['path', {d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'}],
      ['path', {d: 'M3 3v5h5'}],
      ['path', {d: 'M12 7v5l4 2'}],
    ],
  },
  document: {
    protocol: 'doc',
    category: 'documents',
    plugin: 'library',
    icon: Icons.Library,
    svgElements: [
      ['path', {d: 'm16 6 4 14'}],
      ['path', {d: 'M12 6v14'}],
      ['path', {d: 'M8 8v12'}],
      ['path', {d: 'M4 4v16'}],
    ],
  },
  folder: {
    protocol: 'folder',
    category: 'documents',
    plugin: 'library',
    icon: Icons.Folder,
    svgElements: [
      ['path', {d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'}],
    ],
  },
  note: {
    protocol: 'note',
    category: 'notes',
    plugin: 'notes',
    icon: Icons.NotebookText,
    svgElements: [
      ['path', {d: 'M2 6h4'}],
      ['path', {d: 'M2 10h4'}],
      ['path', {d: 'M2 14h4'}],
      ['path', {d: 'M2 18h4'}],
      ['rect', {width: '16', height: '20', x: '4', y: '2', rx: '2'}],
      ['path', {d: 'M9.5 8h5'}],
      ['path', {d: 'M9.5 12H16'}],
      ['path', {d: 'M9.5 16H14'}],
    ],
  },
  task: {
    protocol: 'task',
    category: 'notes',
    plugin: 'notes',
    icon: Icons.CircleCheck,
    svgElements: [
      ['circle', {cx: '12', cy: '12', r: '10'}],
      ['path', {d: 'm9 12 2 2 4-4'}],
    ],
  },
  tasklist: {
    protocol: 'tasklist',
    category: 'notes',
    plugin: 'notes',
    icon: Icons.ListChecks,
    svgElements: [
      ['path', {d: 'm3 17 2 2 4-4'}],
      ['path', {d: 'm3 7 2 2 4-4'}],
      ['path', {d: 'M13 6h8'}],
      ['path', {d: 'M13 12h8'}],
      ['path', {d: 'M13 18h8'}],
    ],
  },
} as const satisfies Record<ReferenceRefType, ReferenceTypeConfig>;

export const REFERENCE_CATEGORIES: Array<{id: ReferenceCategory; label: string; primaryIcon: LucideIcon}> = [
  {id: 'threads', label: 'Threads', primaryIcon: Icons.History},
  {id: 'documents', label: 'Library', primaryIcon: Icons.Library},
  {id: 'notes', label: 'Notes', primaryIcon: Icons.NotebookText},
];

export const PROTOCOL_TO_TYPE: Record<string, ReferenceRefType> = Object.fromEntries(
  Object.entries(REFERENCE_TYPES).map(([type, config]) => [config.protocol, type as ReferenceRefType])
) as Record<string, ReferenceRefType>;

export const ALL_PROTOCOLS: string[] = Object.values(REFERENCE_TYPES).map(config => config.protocol);

export const NOTE_TYPE_TO_REF_TYPE: Record<string, ReferenceRefType> = {
  document: 'note',
  task: 'task',
  tasklist: 'tasklist',
};

export function referenceIconFor(refType: ReferenceCategory | ReferenceRefType) {
  const category = REFERENCE_CATEGORIES.find(item => item.id === refType);
  if (category) return category.primaryIcon;
  return REFERENCE_TYPES[refType as ReferenceRefType]?.icon ?? Icons.History;
}

export function referenceSvgElementsFor(refType: ReferenceCategory | ReferenceRefType) {
  if (refType === 'threads') return REFERENCE_TYPES.thread.svgElements;
  if (refType === 'documents') return REFERENCE_TYPES.document.svgElements;
  if (refType === 'notes') return REFERENCE_TYPES.note.svgElements;
  return REFERENCE_TYPES[refType as ReferenceRefType]?.svgElements ?? REFERENCE_TYPES.thread.svgElements;
}

export function referenceTypeForProtocol(protocol: string): ReferenceRefType | null {
  return PROTOCOL_TO_TYPE[protocol] ?? null;
}

export function categoryOfType(type: ReferenceRefType): ReferenceCategory {
  return REFERENCE_TYPES[type].category;
}

export function referenceCategoryLabel(category: ReferenceCategory | null) {
  return REFERENCE_CATEGORIES.find(item => item.id === category)?.label ?? '';
}
