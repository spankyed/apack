import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect } from '@apackdev/testing';

test('real onboarding writes app and feature preferences without a settings assembly', async ({ app, appPage }) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-onboarding-project-'));
  const cli = path.join(directory, process.platform === 'win32' ? 'unavailable.cmd' : 'unavailable');
  // A configured executable that fails detection avoids fallback to the developer's installed CLIs
  // and their session directories. The authored flow and services remain real.
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
  const readJson = () => appPage.evaluate(async () => (await (window as any).__loadMonaco()).editor.getEditors()
    .find((editor: any) => editor.getDomNode()?.getBoundingClientRect().width > 0
      && editor.getModel()?.getLanguageId() === 'json').getModel().getValue() as string);
  const saveJson = async (text: string) => {
    await appPage.evaluate(async text => (await (window as any).__loadMonaco()).editor.getEditors()
      .find((editor: any) => editor.getDomNode()?.getBoundingClientRect().width > 0
        && editor.getModel()?.getLanguageId() === 'json').getModel().setValue(text), text);
    await appPage.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(appPage.getByText('Saved', { exact: true })).toBeVisible();
  };
  const lifecycle = async () => {
    await app.navigate('default-setup/database');
    await appPage.evaluate(() => {
      const actor = (window as any).applicationState.system.get('default-setup/database');
      actor.send({ type: 'BACK_TO_EXPLORER' });
      actor.send({ type: 'QUERY.UPDATE', code: `return {
        app: query('AppState').pickOne(['hasOnboarded']),
        threads: query.all().withRole('assistant_birth').pick(['context', 'topic'])
      };` });
    });
    // The component's useSurface send supplies the reply address. Sending a raw actor event from
    // evaluate would bypass that delivery context and leave the query without an asker.
    await appPage.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.system
      .get('default-setup/database').getSnapshot().context.pendingQueryCall)).toBeNull();
    const result = await appPage.evaluate(() => {
      const context = (window as any).applicationState.system.get('default-setup/database').getSnapshot().context;
      return { value: context.queryResult, error: context.error };
    });
    expect(result.error).toBeNull();
    return result.value;
  };
  let original: string | undefined;
  let failed = false;
  let failure: unknown;
  try {
    fs.writeFileSync(cli, process.platform === 'win32' ? '@exit /b 1\r\n' : '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await openJson();
    original = await readJson();
    const values = JSON.parse(original);
    values.app.projects = [{ name: 'Acceptance project', directories: [directory], color: '#3B82F6' }];
    values.features['default-setup/code'].cliPaths = { 'claude-code': cli, codex: cli };
    await saveJson(JSON.stringify(values, null, 2));
    await appPage.evaluate(() => (window as any).__sendToSystem('default-setup/brain', { type: 'START_BRAIN' }));
    await app.navigate('default-setup/threads');
    await expect(appPage.getByText('Welcome! Ready to get started?', { exact: true })).toBeVisible();
    await appPage.getByText("Let's go", { exact: true }).click();
    await expect(appPage.getByText('Select a project directory', { exact: true })).toBeVisible();
    await appPage.getByRole('button', { name: /Acceptance project/ }).click();
    await expect(appPage.getByText(/You're all setup! Click/)).toBeVisible();
    await openJson();
    const completed = JSON.parse(await readJson());
    expect(completed.app.projects[0].directories).toEqual([directory]);
    expect(completed.features['default-setup/code'].defaultBaseDirectory).toBe(directory);
    const before = await lifecycle();
    expect(before.app.hasOnboarded).toBe(true);
    expect(before.threads).toHaveLength(1);
    expect(before.threads[0].context.onboarding.step).toBe('complete');
    // Restoring preferences must not undo completion or manufacture another lifecycle owner.
    await openJson();
    await saveJson(original);
    expect(await lifecycle()).toEqual(before);
    await appPage.evaluate(() => (window as any).__sendToSystem('default-setup/brain', { type: 'RESTART_BRAIN' }));
    expect(await lifecycle()).toEqual(before);
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    if (original !== undefined) {
      await openJson();
      if (await readJson() !== original) await saveJson(original);
    }
  } catch (error) {
    if (!failed) { failed = true; failure = error; }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  if (failed) throw failure;
});
