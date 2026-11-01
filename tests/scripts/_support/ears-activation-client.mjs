// Real RPC activation; diagnostic only, not the renderer's five-second acceptance case.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import { createWSClient, createTRPCClient, wsLink } from '@trpc/client';
import WebSocket from 'ws';

const output = process.argv[2], pid = Number(process.env.EARS_API_PID), hook = process.env.EARS_ACTIVATION_REPORT;
assert(pid > 1 && output && hook && !existsSync(output));
class ApiSocket extends WebSocket {
  constructor(url) { super(url, ['apack', `apack-token.${process.env.APACK_API_TOKEN}`]); }
}
const ws = createWSClient({ url: `ws://127.0.0.1:${process.env.API_PORT}`, WebSocket: ApiSocket });
const rpc = createTRPCClient({ links: [wsLink({ client: ws })] });
let subscription, deadline;
async function observeState(state) {
  for (let i = 0; i < 100; i++) {
    if (existsSync(hook) && JSON.parse(readFileSync(hook)).state === state) return;
    await pause(20);
  }
  throw Error(`Activation observer did not reach ${state}`);
}
try {
  const result = await Promise.race([(async () => {
    assert(!(await rpc.packs.loaded.query()).some(pack => pack.id === 'default-setup'));
    let startSubscription, activated, failed;
    const subscribed = new Promise(resolve => { startSubscription = resolve; });
    const ready = new Promise((resolve, reject) => { activated = resolve; failed = reject; });
    subscription = rpc.bus.sub.subscribe(undefined, {
      onStarted: startSubscription,
      onData(message) {
        if (message.event?.type === 'PACK_ACTIVATED' && message.event.packId === 'default-setup') activated();
      },
      onError: failed,
    });
    await subscribed;
    process.kill(pid, 'SIGUSR2'); await observeState('active');
    const at = performance.now();
    await rpc.bus.send.mutate({ to: 'host/packs', event: { type: 'TOGGLE_PACK_ENABLED', packId: 'default-setup' } });
    const mutationReturnedMs = performance.now() - at;
    await ready;
    const backendReadyMs = performance.now() - at;
    assert((await rpc.packs.loaded.query()).some(pack => pack.id === 'default-setup'));
    const servedAfterReadyMs = performance.now() - at;
    process.kill(pid, 'SIGUSR2'); await observeState('complete');
    return { source: process.env.EARS_TEST_SOURCE, backend: process.env.APACK_STORAGE_FORMAT,
      mutationReturnedMs, backendReadyMs, servedAfterReadyMs,
      profile: JSON.parse(readFileSync(hook)), completed: true };
  })(), new Promise((_, reject) => {
    deadline = setTimeout(() => reject(Error('Activation diagnostic exceeded its 30s observation window')), 30000);
  })]);
  writeFileSync(output, JSON.stringify(result, null, 2));
} catch (error) {
  writeFileSync(output, JSON.stringify({ failure: { message: error.message, stack: error.stack } }, null, 2));
  throw error;
} finally { clearTimeout(deadline); subscription?.unsubscribe(); ws.close(); }
