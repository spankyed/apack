import type { MemoNoteDTO } from './memo-notes.ts';
import type { BaseEntity, EARS, ShortCodeOf } from '#generated/ears.ts';

export interface MemoEntity extends BaseEntity {
  entityType: EARS.Entity.Memo;
  /** Written memos have a title; an apply matches existing entities by it */
  title?: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoDTO {
  id: string;
  shortCode: ShortCodeOf<'Memo'>;
  text: string;
  createdAt: number;
}

export type IncomingMemosEvents =
  | { type: 'ADD_MEMO'; text: string }
  | { type: 'ADD_MEMO_NOTE'; text: string }
  | { type: 'ANNOUNCE_MEMO'; text: string };

export type OutgoingMemosEvents =
  | { type: 'MEMOS_CONNECTED'; memos: MemoDTO[] }
  | { type: 'MEMO_ADDED'; memo: MemoDTO }
  /** `note` is null when the note written with `untypedCreate` isn't found through the SDK's services */
  | { type: 'MEMO_NOTE_ADDED'; text: string; note: MemoNoteDTO | null };
