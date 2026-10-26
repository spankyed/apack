import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createTRPCUntypedClient, createWSClient, wsLink } from '@trpc/client';
import type { SettingsSnapshot } from '@apackdev/sdk/types';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { test, expect } from '@apackdev/testing';
import { acceptedRuntime, frontendAccepted } from './_support/pack-frontend.ts';

const companion = fileURLToPath(new URL('../../../bundled-ui-pack/', import.meta.url));
test('backup import restores all settings owners and updates an open window', async ({ app, appPage, electronApp }) => {
  const backups = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-settings-restore-'));
  let second: Awaited<ReturnType<typeof electronApp.firstWindow>> | undefined;
  const toggleCompanion = () => appPage.evaluate(() => (window as any).applicationState.system.get('host/packs')
    .send({ type: 'UI.TOGGLE_ENABLED', packId: 'bundled-ui-fixture' }));
  const openJson = async () => {
    await app.navigate('host/settings');
    await appPage.evaluate(() => {
      const actor = (window as any).applicationState.system.get('host/settings');
      actor.send({ type: 'TAB.SELECT', tab: 'general' });
      actor.send({ type: 'GENERAL_NAV.SELECT', item: 'json' });
    });
    await expect(appPage.getByRole('heading', { name: 'Settings JSON' })).toBeVisible();
    await expect(appPage.locator('.monaco-editor')).toBeVisible();
  };
  const change = async (prefix: string) => {
    await openJson();
    const original = await appPage.evaluate(prefix => {
      const model = (window as any).monaco.editor.getEditors().find((editor: any) =>
        editor.getDomNode()?.getBoundingClientRect().width > 0 && editor.getModel()?.getLanguageId() === 'json').getModel();
      const original = model.getValue() as string;
      const values = JSON.parse(original);
      values.app.personal.name = `${prefix} Person`;
      values.packs['e2e-fixture'].assistant.name = `${prefix} Memo assistant`;
      values.packs['bundled-ui-fixture'].assistant.name = `${prefix} Scribbles assistant`;
      values.features['e2e-fixture/memos'].listTitle = `${prefix} Memos`;
      model.setValue(JSON.stringify(values, null, 2));
      return original;
    }, prefix);
    await expect(appPage.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await appPage.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(appPage.getByText('Saved', { exact: true })).toBeVisible();
    return original;
  };
  const backupResult = () => appPage.evaluate(() => (window as any).applicationState.system
    .get('default-setup/database').getSnapshot().context.backupResult);
  try {
    await appPage.evaluate(packSlug => (window as any).__sendToSystem('host/packs', {
      type: 'INSTALL_PACK', packSlug, sourceKind: 'local',
    }), companion);
    await app.waitForSurface('bundled-ui-fixture/scribbles');
    const original = await change('Saved');
    const companionRuntime = await acceptedRuntime(appPage, 'bundled-ui-fixture');
    const opened = electronApp.waitForEvent('window');
    await appPage.evaluate(() => (window as any).electronAPI.surfaces.popout('host/settings', 'Settings'));
    second = await opened;
    await second.waitForLoadState('domcontentloaded');
    await second.getByRole('button', { name: 'Features', exact: true }).click();
    await second.getByText('e2e-fixture/memos', { exact: true }).click();
    const other = second.getByTestId('memos-list-title');
    await expect(other).toHaveValue('Saved Memos');
    await toggleCompanion();
    await app.navigate('default-setup/database');
    await appPage.evaluate(targetPath => {
      const actor = (window as any).applicationState.system.get('default-setup/database');
      actor.send({ type: 'VIEW_BACKUP' });
      actor.send({ type: 'BACKUP.EXPORT', path: targetPath, name: 'settings', databases: ['lmdb'] });
    }, backups);
    try {
      await expect.poll(backupResult).toEqual({ operation: 'export' });
    } catch (error) {
      const state = await appPage.evaluate(() => {
        const snapshot = (window as any).applicationState.system.get('default-setup/database').getSnapshot();
        return { status: snapshot.status, state: snapshot.value,
          exporting: snapshot.context.exporting, backupResult: snapshot.context.backupResult };
      });
      const files: Record<string, number> = {};
      for (const file of fs.readdirSync(backups, { recursive: true })) {
        const stat = fs.statSync(path.join(backups, String(file)));
        if (stat.isFile()) files[String(file)] = stat.size;
      }
      const diagnostic = test.info().outputPath('backup-export-stall.json');
      fs.writeFileSync(diagnostic, JSON.stringify({ state, files }, null, 2));
      await test.info().attach('backup-export-stall', { contentType: 'application/json', path: diagnostic });
      if (process.env.DEBUG_E2E === 'sample' && process.platform === 'darwin') {
        try {
          const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'));
          const { apiPortFile } = resolveAppEnvironment({ env: 'test', userDataDir });
          const { pid } = JSON.parse(fs.readFileSync(apiPortFile, 'utf8'));
          const parent = Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid='], { encoding: 'utf8' }));
          if (parent !== electronApp.process().pid) throw new Error('The recorded API is not this fixture’s child');
          const sample = test.info().outputPath('backup-api.sample.txt');
          execFileSync('/usr/bin/sample', [String(pid), '2', '-file', sample], { timeout: 10_000 });
          await test.info().attach('backup-api-sample', { contentType: 'text/plain', path: sample });
        } catch (sampleError) { console.log('[backup diagnostic] sampling failed', String(sampleError)); }
      }
      throw error;
    }
    const entries = fs.readdirSync(backups);
    expect(entries).toHaveLength(1);
    const backup = path.join(backups, entries[0]);
    await change('Changed');
    await expect(other).toHaveValue('Changed Memos');
    await app.navigate('default-setup/database');
    await appPage.evaluate(backupPath => {
      const actor = (window as any).applicationState.system.get('default-setup/database');
      actor.send({ type: 'VIEW_BACKUP' });
      actor.send({ type: 'BACKUP.IMPORT', path: backupPath });
    }, backup);
    await expect.poll(backupResult).toMatchObject({ operation: 'import', error: undefined,
      message: expect.stringContaining('restart the brain manually') });
    await expect(other).toHaveValue('Saved Memos');
    await openJson();
    const restored = await appPage.evaluate(() => {
      const model = (window as any).monaco.editor.getEditors().find((editor: any) =>
        editor.getDomNode()?.getBoundingClientRect().width > 0 && editor.getModel()?.getLanguageId() === 'json').getModel();
      return JSON.parse(model.getValue());
    });
    expect(restored.app.personal.name).toBe('Saved Person');
    expect(restored.packs['e2e-fixture'].assistant.name).toBe('Saved Memo assistant');
    expect(restored.packs['bundled-ui-fixture'].assistant.name).toBe('Saved Scribbles assistant');
    expect(restored.features['e2e-fixture/memos'].listTitle).toBe('Saved Memos');
    await toggleCompanion();
    await frontendAccepted(appPage, 'bundled-ui-fixture', companionRuntime);
    await appPage.locator('[data-onboarding-id="settings-packs-tab"]').click();
    await appPage.getByText('bundled-ui-fixture/assistant', { exact: true }).click();
    await expect(appPage.getByLabel('Scribbles assistant name', { exact: true })).toHaveValue('Saved Scribbles assistant');
    // These fixtures share an app within a worker; restore the incoming preferences for subsequent cases.
    await openJson();
    await appPage.evaluate(original => {
      const editor = (window as any).monaco.editor.getEditors().find((editor: any) =>
        editor.getDomNode()?.getBoundingClientRect().width > 0 && editor.getModel()?.getLanguageId() === 'json');
      editor.getModel().setValue(original);
    }, original);
    await appPage.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(appPage.getByText('Saved', { exact: true })).toBeVisible();
    await appPage.locator('[data-onboarding-id="settings-packs-tab"]').click();
    await appPage.getByText('e2e-fixture/assistant', { exact: true }).click();
    await expect(appPage.getByLabel('Fixture assistant name', { exact: true }))
      .toHaveValue(JSON.parse(original).packs['e2e-fixture'].assistant.name);
    await appPage.evaluate(() => (window as any).__sendToSystem('host/packs', {
      type: 'UNINSTALL_PACK', packId: 'bundled-ui-fixture',
    }));
    await expect(appPage.getByText('bundled-ui-fixture/assistant', { exact: true })).toHaveCount(0);
  } finally {
    await second?.close();
    fs.rmSync(backups, { recursive: true, force: true });
  }
});

test('two external assistant groups survive independent edits, disable, reset and reinstall', async ({ app, appPage }) => {
  const install = () => appPage.evaluate(packSlug => (window as any).__sendToSystem('host/packs', {
    type: 'INSTALL_PACK', packSlug, sourceKind: 'local',
  }), companion);
  await install();
  await app.waitForSurface('bundled-ui-fixture/scribbles');
  await app.navigate('host/settings');
  await appPage.locator('[data-onboarding-id="settings-packs-tab"]').click();
  const select = (owner: string) => appPage.getByText(`${owner}/assistant`, { exact: true }).click();
  const memo = appPage.getByLabel('Fixture assistant name', { exact: true });
  const scribbles = appPage.getByLabel('Scribbles assistant name', { exact: true });
  await select('e2e-fixture');
  await expect(memo).toHaveValue('Memo helper');
  await memo.fill('Morgan'); await memo.blur();
  await expect(appPage.getByText('Settings saved', { exact: true })).toBeVisible();
  await select('bundled-ui-fixture');
  await expect(scribbles).toHaveValue('Scribbles helper');
  await scribbles.fill('Sydney'); await scribbles.blur();
  await expect(appPage.getByText('Settings saved', { exact: true })).toBeVisible();

  const toggle = (packId: string) => appPage.evaluate(packId => (window as any).applicationState.system.get('host/packs')
    .send({ type: 'UI.TOGGLE_ENABLED', packId }), packId);
  for (const owner of ['e2e-fixture', 'bundled-ui-fixture']) {
    await select(owner);
    const runtime = await acceptedRuntime(appPage, owner);
    await toggle(owner);
    await expect(appPage.getByRole('button', { name: 'Edit in JSON', exact: true })).toBeVisible();
    await expect(appPage.getByText(`${owner}/assistant`, { exact: true })).toBeVisible();
    await select(owner === 'e2e-fixture' ? 'bundled-ui-fixture' : 'e2e-fixture');
    await expect(owner === 'e2e-fixture' ? scribbles : memo).toHaveValue(owner === 'e2e-fixture' ? 'Sydney' : 'Morgan');
    await toggle(owner);
    await frontendAccepted(appPage, owner, runtime);
    await select(owner);
    await expect(owner === 'e2e-fixture' ? memo : scribbles).toHaveValue(owner === 'e2e-fixture' ? 'Morgan' : 'Sydney');
  }

  await select('bundled-ui-fixture');
  await appPage.getByTitle('Reset to defaults', { exact: true }).click();
  await appPage.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(scribbles).toHaveValue('Scribbles helper');
  await select('e2e-fixture');
  await expect(memo).toHaveValue('Morgan');
  await select('bundled-ui-fixture');
  await scribbles.fill('Restored Sydney'); await scribbles.blur();
  await expect(appPage.getByText('Settings saved', { exact: true })).toBeVisible();
  await appPage.evaluate(() => (window as any).__sendToSystem('host/packs', { type: 'UNINSTALL_PACK', packId: 'bundled-ui-fixture' }));
  await expect(appPage.getByText('bundled-ui-fixture/assistant', { exact: true })).toHaveCount(0);
  await install();
  await app.waitForSurface('bundled-ui-fixture/scribbles');
  await select('bundled-ui-fixture');
  await expect(scribbles).toHaveValue('Restored Sydney');
  await select('e2e-fixture');
  await expect(memo).toHaveValue('Morgan');
});

test('accepted dependency credentials enforce shared, owner-only and reload boundaries', async ({ appPage, app }, testInfo) => {
  // One cold backend build (180s), typecheck (20s), then credential/lifecycle checks (40s).
  test.setTimeout(240_000);
  const root = fileURLToPath(new URL('../../../../../', import.meta.url));
  const dependent = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-settings-dependent-'));
  const id = 'settings-dependent';
  let installed = false;
  const messages: { answering?: string; event: Record<string, unknown> }[] = [];
  const address = await appPage.evaluate(() => ({
    port: (window as any).electronAPI.apiPort as number,
    token: (window as any).electronAPI.apiToken as string,
  }));
  const ws = createWSClient({ url: `ws://127.0.0.1:${address.port}`, WebSocket: class extends WebSocket {
    constructor(url: string | URL) { super(url, ['apack', `apack-token.${address.token}`]); }
  } });
  const client = createTRPCUntypedClient({ links: [wsLink({ client: ws })] });
  let subscription: { unsubscribe(): void } | undefined;
  // An install answers with its outcome, complete or failed with its error, however long it takes on this machine
  const installs = new Map<string, (outcome: Record<string, unknown>) => void>();
  const outcomeOf = (packSlug: string) => new Promise<Record<string, unknown>>(resolve => installs.set(packSlug, resolve));
  const ready = new Promise<void>((resolve, reject) => {
    subscription = client.subscription('bus.sub', undefined, { onStarted: () => resolve(), onError: reject,
      onData: data => {
        const message = data as (typeof messages)[number];
        messages.push(message);
        if (message.event.type === 'PACK_INSTALL_COMPLETE' || message.event.type === 'PACK_INSTALL_FAILED') {
          installs.get(message.event.packSlug as string)?.(message.event);
        }
      } });
  });
  const loaded = async () => await client.query('packs.loaded') as { id: string; registrationId: string; declarationRevision: string; buildRevision: string }[];
  const credential = async (packId: string) => {
    const origin = (await loaded()).find(pack => pack.id === packId)!;
    return await client.mutation('settings.openPack', {
      id: origin.id, registrationId: origin.registrationId, declarationRevision: origin.declarationRevision, buildRevision: origin.buildRevision,
    }) as string;
  };
  const ask = async (settingsCredential: string, event: Record<string, unknown>) => {
    const call = randomUUID();
    await client.mutation('bus.send', { to: 'host/settings', sender: 'host/drive', call, settingsCredential, event });
    await expect.poll(() => messages.find(message => message.answering === call)).toBeTruthy();
    return messages.find(message => message.answering === call)!.event;
  };
  const target = (groupId: string) => ({ kind: 'pack', packId: 'bundled-ui-fixture', groupId });
  const toggle = () => appPage.evaluate(packId => (window as any).applicationState.system.get('host/packs')
    .send({ type: 'UI.TOGGLE_ENABLED', packId }), id);
  try {
    await ready;
    await client.mutation('bus.claim', { as: 'host/drive' });
    await appPage.evaluate(packSlug => (window as any).__sendToSystem('host/packs', {
      type: 'INSTALL_PACK', packSlug, sourceKind: 'local',
    }), companion);
    await app.waitForSurface('bundled-ui-fixture/scribbles');
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(dependent, 'node_modules'), 'dir');
    fs.writeFileSync(path.join(dependent, 'package.json'), JSON.stringify({ name: id, type: 'module' }));
    fs.writeFileSync(path.join(dependent, 'apack.json'), JSON.stringify({ id, name: 'Settings dependent', version: '1.0.0',
      hostVersion: '>=0.3.0', data: { entities: {}, relations: [] }, features: {}, dependencies: { 'bundled-ui-fixture': `file:${companion}` } }));
    execFileSync(process.execPath, [path.join(root, 'packages/apack-cli/bin/apack.mjs'), 'pack', 'build'], {
      cwd: dependent, env: { ...process.env, APACK_HOST: root }, stdio: 'pipe', timeout: 180_000,
    });
    fs.copyFileSync(path.join(companion, 'tsconfig.json'), path.join(dependent, 'tsconfig.json'));
    fs.mkdirSync(path.join(dependent, 'tests'));
    fs.writeFileSync(path.join(dependent, 'tests/settings-types.ts'), `
import { packSettings } from '#generated/settings.ts';
const shared = packSettings.forGroup('bundled-ui-fixture/assistant');
shared.set({ path: ['name'], value: 'Typed' });
shared.reset();
const restricted = packSettings.forGroup('bundled-ui-fixture/restricted');
const count: number = restricted.get().count;
void count;
// @ts-expect-error Owner-only dependency handles cannot mutate.
restricted.set({ path: ['count'], value: 2 });
// @ts-expect-error Owner-only dependency handles cannot reset.
restricted.reset();
// @ts-expect-error A schema-derived string field does not accept numbers.
shared.set({ path: ['name'], value: 2 });
`);
    execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', dependent], {
      cwd: dependent, stdio: 'pipe', timeout: 20_000,
    });
    const outcome = outcomeOf(dependent);
    await appPage.evaluate(packSlug => (window as any).__sendToSystem('host/packs', {
      type: 'INSTALL_PACK', packSlug, sourceKind: 'local',
    }), dependent);
    expect(await outcome).toMatchObject({ type: 'PACK_INSTALL_COMPLETE', packId: id });
    expect((await loaded()).map(pack => pack.id)).toContain(id);
    installed = true;
    const owner = await credential('bundled-ui-fixture');
    const access = await credential(id);
    expect(await ask(owner, { type: 'UPDATE_SETTINGS', target: target('restricted'), path: ['count'], value: 3 })).toMatchObject({ type: 'SETTINGS_SAVED' });
    const before = (await ask(access, { type: 'GET_SETTINGS' })).snapshot as SettingsSnapshot;
    const messageStart = messages.length;
    expect(before.values.packs['bundled-ui-fixture'].restricted).toEqual({ count: 3 });
    for (const event of [
      { type: 'UPDATE_SETTINGS', target: target('restricted'), path: ['count'], value: 4, caller: 'bundled-ui-fixture' },
      { type: 'RESET_SETTINGS', target: target('restricted') },
    ]) {
      expect(await ask(access, event)).toMatchObject({ type: 'SETTINGS_REFUSED', problems: [expect.stringContaining('Only pack "bundled-ui-fixture"')] });
    }
    for (const event of [{ type: 'RESET_ALL_SETTINGS' }, { type: 'REPLACE_SETTINGS', data: before.values }]) {
      expect(await ask(access, event)).toMatchObject({ type: 'SETTINGS_REFUSED', problems: [expect.stringContaining('host settings administration')] });
    }
    const unchanged = (await ask(access, { type: 'GET_SETTINGS' })).snapshot as SettingsSnapshot;
    try {
      expect(unchanged.values).toEqual(before.values);
      expect(unchanged.revision).toBe(before.revision);
    } catch (error) {
      await testInfo.attach('settings-during-refusals', {
        contentType: 'application/json',
        body: JSON.stringify({ before: { revision: before.revision, values: before.values },
          after: { revision: unchanged.revision, values: unchanged.values },
          updates: messages.slice(messageStart).filter(message => message.event.type === 'SETTINGS_UPDATED')
            .map(message => {
              const snapshot = message.event.snapshot as SettingsSnapshot;
              return { revision: snapshot.revision, values: snapshot.values };
            }),
        }, null, 2),
      });
      throw error;
    }
    expect(await ask(access, { type: 'UPDATE_SETTINGS', target: target('assistant'), path: ['name'], value: 'Dependency edit' })).toMatchObject({ type: 'SETTINGS_SAVED' });
    await app.navigate('host/settings');
    await appPage.locator('[data-onboarding-id="settings-packs-tab"]').click();
    await appPage.getByText('bundled-ui-fixture/assistant', { exact: true }).click();
    await expect(appPage.getByLabel('Scribbles assistant name', { exact: true })).toHaveValue('Dependency edit');
    expect(await ask(access, { type: 'RESET_SETTINGS', target: target('assistant') })).toMatchObject({ type: 'SETTINGS_SAVED' });
    await expect(appPage.getByLabel('Scribbles assistant name', { exact: true })).toHaveValue('Scribbles helper');
    const previousRuntime = (await loaded()).find(pack => pack.id === id)!;
    await toggle();
    await expect.poll(async () => (await loaded()).map(pack => pack.id)).not.toContain(id);
    await expect(ask(access, { type: 'UPDATE_SETTINGS', target: target('assistant'), path: ['name'], value: 'Stale' })).rejects.toThrow('Settings access is unavailable');
    await toggle();
    await expect.poll(async () => (await loaded()).map(pack => pack.id)).toContain(id);
    const replacementRuntime = (await loaded()).find(pack => pack.id === id)!;
    expect(replacementRuntime.buildRevision).toBe(previousRuntime.buildRevision);
    expect(replacementRuntime.registrationId).not.toBe(previousRuntime.registrationId);
    await expect(client.mutation('settings.openPack', {
      id, registrationId: previousRuntime.registrationId,
      declarationRevision: previousRuntime.declarationRevision, buildRevision: previousRuntime.buildRevision,
    })).rejects.toThrow('Settings access is unavailable');
    const fresh = await credential(id);
    expect(await ask(fresh, { type: 'UPDATE_SETTINGS', target: target('assistant'), path: ['name'], value: 'Fresh' })).toMatchObject({ type: 'SETTINGS_SAVED' });
    await expect(appPage.getByLabel('Scribbles assistant name', { exact: true })).toHaveValue('Fresh');
    expect(await ask(owner, { type: 'RESET_SETTINGS', target: target('restricted') })).toMatchObject({ type: 'SETTINGS_SAVED' });
  } finally {
    subscription?.unsubscribe(); ws.close();
    if (installed) await appPage.evaluate(packId => (window as any).__sendToSystem('host/packs', { type: 'UNINSTALL_PACK', packId }), id);
    fs.rmSync(dependent, { recursive: true, force: true });
  }
});
