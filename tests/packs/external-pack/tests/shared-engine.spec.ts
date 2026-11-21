// One EARS engine: a row written with the SDK's untyped engine operations reads back through default-setup's
// repository, which default-setup's runtime registered on the engine it was given — and the SDK's services object
// reaches that same registration rather than a copy of it
import { describe, expect, it } from 'vitest';
import { untypedCreate } from '@apackdev/sdk/ears';
import { services } from '#generated/services.ts';
import { startApp } from '@apackdev/testing/harness';
import { repository } from '#generated/repository.ts';

describe('the engine a pack imports', () => {
  it("is the one the SDK and its dependencies' runtimes use", () => {
    const id = untypedCreate('Note', { title: 'Written untyped', content: '', noteType: 'document', icon: null, completed: false, hideCompletedChildren: false, displayOrder: 0, lastSeen: 0 }).id();
    // Typed, through the facade codegen writes: this pack's repositories and its dependencies'
    expect(repository.noteQueries.byIdDTO(id)).toMatchObject({ id, title: 'Written untyped' });
    expect(services.repository.noteQueries.byIdDTO(id)).toEqual(repository.noteQueries.byIdDTO(id));
  });

  it('is the one the memos system writes to and reads back from', async () => {
    const app = await startApp({ systems: ['memos'] });
    await app.connect();
    await app.send('memos', { type: 'ADD_MEMO_NOTE', text: 'a memo note' });
    const added = await app.nextEmit('memos', 'MEMO_NOTE_ADDED');
    expect(added.note).toMatchObject({ id: expect.stringMatching(/^Note-/), title: 'a memo note' });
  });
});
