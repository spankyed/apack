import type { EARS, PromptEntity } from '@apackdev/sdk';
import { state, type PackNet } from '#generated/state.ts';
import type { PromptTab } from '../../contract.ts';
export type { PromptTab } from '../../contract.ts';

type CodeAsks = PackNet['systems']['code']['asks'];

export type CodePromptsReport =
  | { type: 'CODE_PROMPTS_SHOW_TAB'; tab: PromptTab }
  | { type: 'CODE_PROMPTS_PROMPT_SAVED'; prompt: PromptEntity };

export type CodePromptsEvent =
  | { type: 'codePrompts.OPEN_PROMPT'; promptId: string }
  | { type: 'codePrompts.SAVE_PROMPT'; promptId: string; content: string }
  // Tab restoration
  | { type: 'codePrompts.OPEN_TABS'; promptIds: string[] }
  /**
   * What the panel asks of the **prompts surface**: its edits, which that surface sends its system.
   *
   * Sent from this machine rather than from the panel's click handlers: a component is not inside any delivery,
   * so a send it makes carries no `Message.sender` and the prompts surface has no address to answer a refusal or
   * an error to. A send made from this machine carries the code surface's ref.
   */
  | { type: 'codePrompts.UPDATE_INPUTS'; promptId: string; inputs: Record<string, unknown> }
  | { type: 'codePrompts.UPDATE_LABEL'; promptId: string; label: string }
  | { type: 'codePrompts.DELETE'; promptId: EARS.EntityId }
  | { type: 'codePrompts.CREATE_INLINE'; label: string; templateFn: string; inputs: Record<string, unknown> };

type CodePromptsShape = {
  reports: CodePromptsReport;
  calls: {
    open: { readonly many: CodeAsks['codePrompts.OPEN_PROMPT']['args'] };
    save: { readonly many: CodeAsks['codePrompts.SAVE_PROMPT']['args'] };
  };
};

export const promptsState = state<CodePromptsShape, CodePromptsEvent>()({
  calls: ({ many }) => ({
    // The asks about a prompt's template. Several run at once, one per tab opening or saving.
    open: many('code', 'codePrompts.OPEN_PROMPT', {
      done: (outcome, { report }) => {
        if (!outcome.ok) return;
        const prompt = outcome.value;
        const tab: PromptTab = {
          path: `prompt:${prompt.id}`,
          content: prompt.templateFnContent || prompt.templateFn || '',
          modified: false,
          isPrompt: true,
          promptEntity: prompt,
        };
        report({ type: 'CODE_PROMPTS_SHOW_TAB', tab });
      },
    }),
    save: many('code', 'codePrompts.SAVE_PROMPT', {
      done: (outcome, { report }) => {
        if (!outcome.ok) return;
        report({ type: 'CODE_PROMPTS_PROMPT_SAVED', prompt: outcome.value });
      },
    }),
  }),
  on: {
    'codePrompts.OPEN_PROMPT': ({ promptId }, { call }) => {
      call('open', { promptId });
    },
    'codePrompts.SAVE_PROMPT': ({ promptId, content }, { call }) => {
      call('save', { promptId, templateFn: content });
    },
    'codePrompts.OPEN_TABS': ({ promptIds }, { call }) => {
      for (const promptId of promptIds) {
        call('open', { promptId });
      }
    },
    // The panel's asks of the prompts surface, forwarded from here so each one carries a sender
    'codePrompts.UPDATE_INPUTS': ({ promptId, inputs }, { tell }) => {
      tell({ surface: 'prompts' }, { type: 'PROMPT.UPDATE_INPUTS', promptId, inputs });
    },
    'codePrompts.UPDATE_LABEL': ({ promptId, label }, { tell }) => {
      tell({ surface: 'prompts' }, { type: 'PROMPT.UPDATE_LABEL', promptId, label });
    },
    'codePrompts.DELETE': ({ promptId }, { tell }) => {
      tell({ surface: 'prompts' }, { type: 'PROMPT.DELETE', promptId });
    },
    'codePrompts.CREATE_INLINE': ({ label, templateFn, inputs }, { tell }) => {
      tell({ surface: 'prompts' }, { type: 'PROMPT.CREATE_INLINE', label, templateFn, inputs });
    },
  },
});
