// A send missing a field is reported against the event its `type` names, not every event of the system,
// so the error says which event the send is for.
import * as path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

function diagnosticsFor(source: string): string[] {
  const configFile = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json')!;
  const { config } = ts.readConfigFile(configFile, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root);
  const file = path.join(root, 'src', '__send-to-system-probe.ts');
  const host = ts.createCompilerHost({ ...options, noEmit: true });
  const readFile = host.readFile;
  host.readFile = (name) => (path.resolve(name) === file ? source : readFile(name));
  const fileExists = host.fileExists;
  host.fileExists = (name) => path.resolve(name) === file || fileExists(name);
  const program = ts.createProgram([file], { ...options, noEmit: true }, host);
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(file))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe('sendToSystem diagnostics', () => {
  it('names the event a send with a missing field is for', () => {
    const messages = diagnosticsFor(`import { sendToSystem } from '#generated/events.ts';\nsendToSystem('notes', { type: 'DELETE_NOTE' });\n`);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('DELETE_NOTE');
    // That one event, not the union of everything the notes system receives
    expect(messages[0]).not.toContain('IncomingNoteEvents');
    expect(messages[0]).not.toContain('CREATE_NOTE');
  });

  it('accepts a complete send', () => {
    expect(diagnosticsFor(`import { sendToSystem } from '#generated/events.ts';\nsendToSystem('notes', { type: 'DELETE_NOTE', id: 'Note-1' });\n`)).toEqual([]);
  });
});
