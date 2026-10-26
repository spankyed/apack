// secretsClient calls the bound frontend host's secrets client and nothing else of the API client
import { describe, expect, it } from 'vitest';
import { secretsClient, type SecretsClient } from '../../src/fe/secrets-client.ts';
import { bindFeHost } from '../../src/runtime/fe-host.ts';

describe('secretsClient', () => {
  it('throws, naming bindFeHost, while no frontend host is bound', () => {
    expect(() => secretsClient.list()).toThrow('bindFeHost');
  });

  it("passes each call to the bound frontend host's secrets client, resolving with its snapshot", async () => {
    const snapshot = { secrets: [], status: { protection: 'os-keystore' as const, backend: 'test' } };
    const calls: unknown[][] = [];
    const record = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args]); return snapshot; };
    const host: SecretsClient = {
      list: record('list'), add: record('add'), replaceValue: record('replaceValue'), select: record('select'),
      rename: record('rename'), delete: record('delete'), allowUnprotected: record('allowUnprotected'),
    };
    bindFeHost({ catalog: {} as never, application: {} as never, secrets: host, settings: {} as never, client: { send: () => {}, watchView: () => () => {} }, packs: {} as never });

    await expect(secretsClient.add('openai', 'Work', 'sk-value')).resolves.toBe(snapshot);
    await secretsClient.list();
    await secretsClient.replaceValue('s1', 'sk-new');
    await secretsClient.select('s1');
    await secretsClient.rename('s1', 'Home');
    await secretsClient.delete('s1');
    await secretsClient.allowUnprotected();

    expect(calls).toEqual([
      ['add', 'openai', 'Work', 'sk-value'], ['list'], ['replaceValue', 's1', 'sk-new'], ['select', 's1'],
      ['rename', 's1', 'Home'], ['delete', 's1'], ['allowUnprotected'],
    ]);
  });
});
