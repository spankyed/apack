import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { z } from 'zod';
import type { PerformanceScheduleEntry } from './comparison.ts';
import type { PerformanceTrial } from './report.ts';

const configurationSchema = z.object({ directory: z.string().min(1), deadline: z.number().finite().positive(), mode: z.enum(['disabled', 'lightweight', 'detailed']), lastIndex: z.number().int().min(5).max(104) });
function configuration() {
  const input = process.env.APACK_PERFORMANCE_GATE;
  if (!input) return undefined;
  if (input.length > 4096) throw Error('Invalid revision gate configuration');
  const value = configurationSchema.parse(JSON.parse(input));
  if (!path.isAbsolute(value.directory)) throw Error('Revision gate must have an absolute owned path');
  return value;
}
function read(file: string) {
  const info = lstatSync(file);
  if (!info.isFile() || info.size > 4096) throw Error('Invalid revision gate evidence');
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function performanceExecutionPolicy(comparison?: string) {
  if (configuration()) {
    if (comparison) throw Error('Revision gates cannot contain mode comparisons');
    return 'paired-focused-revisions-v1';
  }
  return comparison ? 'alternating-modes-v1' : 'single-scenario-v1';
}

/** The coordinator grants one action at a time; waiting occurs before recording or readiness timing. */
export async function waitForPerformanceTrial(entry: PerformanceScheduleEntry, target?: { application: ElectronApplication; page: Page }) {
  const gate = configuration();
  if (!gate) return;
  if (entry.mode !== gate.mode || entry.index > gate.lastIndex) throw Error('Revision gate mode differs from its worker');
  writeFileSync(path.join(gate.directory, `ready-${entry.index}.json`), JSON.stringify({ index: entry.index, mode: entry.mode }), { flag: 'wx' });
  const permission = path.join(gate.directory, `permit-${entry.index}.json`);
  while (!existsSync(permission)) {
    if (Date.now() >= gate.deadline) throw Error('Revision coordinator deadline expired');
    await delay(20);
  }
  const value = read(permission) as { index?: unknown; mode?: unknown };
  if (value.index !== entry.index || value.mode !== entry.mode || Date.now() >= gate.deadline) throw Error('Invalid or expired revision permission');
  if (target) {
    const window = await target.application.browserWindow(target.page);
    try { await window.evaluate(window => { window.show(); window.focus(); window.webContents.focus(); }); }
    finally { await window.dispose(); }
    await target.page.waitForFunction(() => document.hasFocus());
  }
}

/** Internal writer acknowledgment, published only after raw data and the execution journal are saved. */
export async function finishPerformanceTrial(entry: PerformanceScheduleEntry, outcome: PerformanceTrial['outcome']) {
  const gate = configuration();
  if (!gate) return;
  const permission = read(path.join(gate.directory, `permit-${entry.index}.json`)) as { index?: unknown; mode?: unknown };
  if (permission.index !== entry.index || permission.mode !== entry.mode) throw Error('Revision permission differs from completed action');
  writeFileSync(path.join(gate.directory, `done-${entry.index}.json`), JSON.stringify({ index: entry.index, mode: entry.mode, outcome }), { flag: 'wx' });
  // Keep the idle worker alive until its peer has finished measuring; teardown is outside both runs.
  if (entry.index === gate.lastIndex) {
    const release = path.join(gate.directory, 'release.json');
    while (!existsSync(release)) {
      if (Date.now() >= gate.deadline) throw Error('Revision release deadline expired');
      await delay(20);
    }
    if ((read(release) as { released?: unknown }).released !== true) throw Error('Invalid revision release');
  }
}
