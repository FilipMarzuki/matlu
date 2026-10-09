import { describe, expect, it } from 'vitest';
import { isArtificerHost, resolveRoute } from './routing';

describe('resolveRoute', () => {
  it('given VITE_DEFAULT_ROUTE=crafter, when / is opened, then it resolves to /crafter', () => {
    expect(resolveRoute('/', 'corewarden.app', { VITE_DEFAULT_ROUTE: 'crafter' })).toBe('/crafter');
  });

  it('given no env var and hostname artificer.localhost, when / is opened, then it resolves to /crafter', () => {
    expect(resolveRoute('/', 'artificer.localhost', {})).toBe('/crafter');
  });

  it('given no env var on localhost, when / is opened, then it resolves to the ordinary default', () => {
    expect(resolveRoute('/', 'localhost', {})).toBe('');
  });

  it('given either host, when /crafter, /settlement, /assets are opened, then the existing routes resolve as today', () => {
    for (const hostname of ['corewarden.app', 'artificer.localhost']) {
      for (const env of [{}, { VITE_DEFAULT_ROUTE: 'crafter' }]) {
        expect(resolveRoute('/crafter', hostname, env)).toBe('/crafter');
        expect(resolveRoute('/settlement', hostname, env)).toBe('/settlement');
        expect(resolveRoute('/assets', hostname, env)).toBe('/assets');
      }
    }
  });
});

describe('isArtificerHost', () => {
  it('given VITE_DEFAULT_ROUTE=crafter, then the host is artificer-branded', () => {
    expect(isArtificerHost('corewarden.app', { VITE_DEFAULT_ROUTE: 'crafter' })).toBe(true);
  });

  it('given no env var and hostname artificer.localhost, then the host is artificer-branded', () => {
    expect(isArtificerHost('artificer.localhost', {})).toBe(true);
  });

  it('given no env var on localhost, then the host is not artificer-branded', () => {
    expect(isArtificerHost('localhost', {})).toBe(false);
  });
});
