// A memo kept as a default-setup note. It's written with the SDK's untyped engine operations (@apackdev/sdk/ears),
// not the generated facade, and read back through the SDK's services with default-setup's repository: the pack, the SDK and its
// dependency's runtime share one engine (SHARED_INSTANCE_PACKAGES).
import { untypedCreate } from '@apackdev/sdk/ears';
import { services } from '#generated/services.ts';

export interface MemoNoteDTO {
  id: string;
  title: string;
}

export function addMemoNote(text: string): MemoNoteDTO | null {
  // A row holds every field its type requires, a dependency's type included
  const id = untypedCreate('Note', { title: text, content: '', noteType: 'document', icon: null, completed: false, hideCompletedChildren: false, displayOrder: 0, lastSeen: 0 }).id();
  const note = services.repository.noteQueries.byIdDTO(id);
  return note ? { id: note.id, title: note.title } : null;
}
