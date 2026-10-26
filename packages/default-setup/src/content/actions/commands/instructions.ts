import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z } from '#generated/services.ts';

export const meta: ActionMeta = {
  label: 'Set Instructions',
  description: 'Create a new thread with instructions, using the first part as the title',
  category: 'commands',
  input: {
    text: { type: 'string', description: 'Instructions text', required: true },
    threadId: { type: 'string', description: 'Thread ID for feedback', required: false },
  },
};

const TOPIC_MAX_LENGTH = 40;

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

export async function action(
  params: Record<string, any>,
  services: Services,
  _z: Z,
  _flowId: string,
) {
  const { text, threadId } = params;

  if (!text?.trim()) {
    if (threadId) {
      services.chat.sendBlockMessage({
        threadId,
        text: 'Usage: /instructions <your instructions text>',
        blocks: [],
      });
    }
    return { success: false, error: 'No instructions provided' };
  }

  const instructions = text.trim();
  const plainText = stripHtml(instructions);
  const topic = plainText.substring(0, TOPIC_MAX_LENGTH);

  const result = services.chat.createThread({ topic, instructions, status: 'Open' });

  if (threadId) {
    services.chat.sendSystemMessage({
      threadId,
      text: `Thread created: ${result.shortCode} — ${topic}`,
    });
  }

  return { success: true, threadId: result.id, shortCode: result.shortCode };
}
