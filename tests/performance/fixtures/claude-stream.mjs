#!/usr/bin/env node
// Deterministic provider process for the real CLI service; never invokes another executable or a network.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.argv.includes('--version')) { console.log('2.1.0-performance-fixture'); process.exit(0); }
if (process.argv.includes('auth')) { console.log(JSON.stringify({ loggedIn: true, authMethod: 'performance-fixture' })); process.exit(0); }
if (!process.argv.includes('-p') && !process.argv.includes('--print')) throw Error('Unexpected fixture invocation');
const script = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'stream.json'), 'utf8'));
const emit = line => process.stdout.write(`${JSON.stringify(line)}\n`);
const input = createInterface({ input: process.stdin });
let started = false;
input.on('line', async line => {
  const message = JSON.parse(line);
  if (message.type === 'control_request') {
    emit({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: {} } });
    return;
  }
  if (message.type !== 'user' || started) return;
  started = true;
  const index = Number(JSON.stringify(message).match(/Performance trial ([0-9]+)/)?.[1] ?? 0);
  const suffix = String(index + 1).padStart(12, '0');
  const session = `00000000-0000-4000-8000-${suffix}`;
  const progressFile = path.join(path.dirname(fileURLToPath(import.meta.url)), `production-${index}.jsonl`);
  writeFileSync(progressFile, '');
  let producedChars = 0;
  emit({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd(), model: 'performance-fixture' });
  emit({ type: 'stream_event', event: { type: 'message_start', message: { id: 'fixture-message', role: 'assistant', content: [] } } });
  emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
  for (const text of script.chunks) {
    await setTimeout(script.intervalMs);
    producedChars += text.length;
    const epochMs = Date.now();
    emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
    appendFileSync(progressFile, `${JSON.stringify({ epochMs, chars: producedChars })}\n`);
  }
  const text = script.chunks.join('');
  emit({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
  emit({ type: 'stream_event', event: { type: 'message_stop' } });
  emit({ type: 'assistant', uuid: `00000000-0000-4001-8000-${suffix}`, message: { role: 'assistant', content: [{ type: 'text', text }] } });
  process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', session_id: session, result: text, duration_ms: script.chunks.length * script.intervalMs, total_cost_usd: 0, num_turns: 1, usage: { input_tokens: 0, output_tokens: 0 } })}\n`, () => process.exit(0));
});
