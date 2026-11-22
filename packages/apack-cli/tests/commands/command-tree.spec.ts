import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS, runCommand } from '../../src/command-tree';

afterEach(() => { vi.restoreAllMocks(); });

describe('explicit app and pack command routing', () => {
  it('advertises export in pack help without loading its handler', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const load = vi.spyOn(COMMANDS.pack.children.export, 'load');
    await runCommand(['pack']);
    await runCommand(['pack', '--help']);
    const help = output.mock.calls.flat().join('\n');
    expect(help).toMatch(/^  export +Write an installable pack archive and checksum$/m);
    expect(help).not.toMatch(/^  archive\s/m);
    expect(load).not.toHaveBeenCalled();
  });

  it.each(['export', 'archive'])('routes pack %s to the export handler', async name => {
    const exportPack = vi.fn(async () => {});
    vi.spyOn(COMMANDS.pack.children.export, 'load').mockResolvedValue(exportPack);
    await runCommand(['pack', name, '--out', '.apack/release']);
    expect(exportPack).toHaveBeenCalledWith(['--out', '.apack/release']);
  });

  it.each(['dev', 'drive', 'test', 'build', 'init', 'clean'])('rejects removed root %s', async name => {
    await expect(runCommand([name])).rejects.toThrow('Unknown command');
  });

  it('routes app and pack doctor to separate handlers with their own arguments', async () => {
    const app = vi.fn(async () => {});
    const pack = vi.fn(async () => {});
    vi.spyOn(COMMANDS.doctor!, 'load').mockResolvedValue(app);
    vi.spyOn(COMMANDS.pack!.children!.doctor!, 'load').mockResolvedValue(pack);
    await runCommand(['doctor', '--channel', 'beta']);
    await runCommand(['pack', 'doctor']);
    expect(app).toHaveBeenCalledWith(['--channel', 'beta']);
    expect(pack).toHaveBeenCalledWith([]);
  });

  it.each(['init-tests', 'build', 'facade-report', 'init', 'replace', 'restore'])('does not execute %s when --help is requested', async name => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const scaffold = vi.spyOn((COMMANDS.pack.children as Record<string, { load: () => Promise<(args: string[]) => Promise<void>> }>)[name]!, 'load');
    await runCommand(['pack', name, '--help']);
    expect(scaffold).not.toHaveBeenCalled();
  });

  it('prints pack uninstall help without invoking the handler', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handler = vi.spyOn(COMMANDS.pack.children.uninstall, 'load');
    await runCommand(['pack', 'uninstall', '--help']);
    expect(handler).not.toHaveBeenCalled();
    expect(output.mock.calls.flat().join('\n')).toContain('Usage: apack pack uninstall');
  });

  it('rejects unknown namespace operations rather than archiving', async () => {
    await expect(runCommand(['pack', 'typo'])).rejects.toThrow('apack pack typo');
    await expect(runCommand(['cache', 'typo'])).rejects.toThrow('apack cache typo');
  });
});
