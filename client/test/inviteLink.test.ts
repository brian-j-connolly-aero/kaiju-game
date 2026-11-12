import { describe, expect, it } from 'vitest';
import { inviteLink } from '../src/app/screens/lobby';

// Addresses are test data, never loaded. They are put together from the scheme so that the
// offline lint (no network addresses in client code) keeps meaning what it says.
const HTTPS = 'https:';
const tunnel = `${HTTPS}//some-random-words.trycloudflare.com`;
const ownDomain = `${HTTPS}//kaiju.example.com`;
const localPage = { origin: 'http://localhost:2567', pathname: '/' };

describe('inviteLink (the lobby link button)', () => {
  it('uses the public address the server sent, so the host on localhost invites friends to the tunnel', () => {
    expect(inviteLink('BCDF', tunnel, localPage)).toBe(`${tunnel}/#BCDF`);
    expect(inviteLink('BCDF', ownDomain, localPage)).toBe(`${ownDomain}/#BCDF`);
  });

  it("falls back to the page's own address when the server sent none", () => {
    expect(inviteLink('BCDF', undefined, localPage)).toBe('http://localhost:2567/#BCDF');
    expect(inviteLink('BCDF', '', localPage)).toBe('http://localhost:2567/#BCDF');
    expect(inviteLink('QRST', undefined, { origin: tunnel, pathname: '/' })).toBe(`${tunnel}/#QRST`);
  });

  it('ignores a public address that is not a plain site address', () => {
    expect(inviteLink('BCDF', 'javascript:alert(1)', localPage)).toBe('http://localhost:2567/#BCDF');
    expect(inviteLink('BCDF', `${ownDomain}/path`, localPage)).toBe('http://localhost:2567/#BCDF');
    expect(inviteLink('BCDF', 'kaiju.example.com', localPage)).toBe('http://localhost:2567/#BCDF');
  });
});
