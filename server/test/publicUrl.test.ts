/**
 * The public address (http/publicUrl.ts): what the server accepts as its address for friends,
 * and that it reaches /healthz and the lobby state. A real quick tunnel cannot be opened from a
 * test, so requests carry the Host header the tunnel passes on ("<words>.trycloudflare.com").
 */

import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv } from '../src/config';
import { parsePublicUrl, PublicAddress, quickTunnelAddress } from '../src/http/publicUrl';
import { options, Player, startTestServer, until, type TestServer } from './netHelpers';

describe('quickTunnelAddress', () => {
  it('turns a quick tunnel host name into its https address', () => {
    expect(quickTunnelAddress('some-random-words.trycloudflare.com')).toBe('https://some-random-words.trycloudflare.com');
    expect(quickTunnelAddress('Some-Random-Words.TryCloudflare.com')).toBe('https://some-random-words.trycloudflare.com');
    expect(quickTunnelAddress('abc123.trycloudflare.com:443')).toBe('https://abc123.trycloudflare.com');
  });

  it('accepts nothing else', () => {
    for (const host of [
      undefined,
      '',
      'localhost:2567',
      '127.0.0.1:2567',
      '192.168.1.20:2567',
      'game:2567',
      'trycloudflare.com',
      '.trycloudflare.com',
      'api.trycloudflare.com',
      'evil.example.com',
      'words.trycloudflare.com.evil.example',
      'words.trycloudflare.community',
      'wordstrycloudflare.com',
      'a.b.trycloudflare.com',
      'evil.com/x.trycloudflare.com',
      'evil.com#.trycloudflare.com',
      'user@words.trycloudflare.com',
      '-bad.trycloudflare.com',
      'words.trycloudflare.com:443:1',
      `${'a'.repeat(120)}.trycloudflare.com`,
    ]) {
      expect(quickTunnelAddress(host), String(host)).toBeNull();
    }
  });
});

describe('PublicAddress', () => {
  it('learns the newest quick tunnel address and ignores other hosts', () => {
    const a = new PublicAddress();
    expect(a.get()).toBeNull();
    expect(a.observe('localhost:2567')).toBe(false);
    expect(a.get()).toBeNull();
    expect(a.observe('first-try.trycloudflare.com')).toBe(true);
    expect(a.observe('first-try.trycloudflare.com')).toBe(false);
    expect(a.observe('192.168.1.20:2567')).toBe(false);
    expect(a.get()).toBe('https://first-try.trycloudflare.com');
    expect(a.observe('second-try.trycloudflare.com')).toBe(true);
    expect(a.get()).toBe('https://second-try.trycloudflare.com');
  });

  it('keeps a configured address whatever requests say', () => {
    const a = new PublicAddress('https://kaiju.example.com');
    expect(a.observe('some-words.trycloudflare.com')).toBe(false);
    expect(a.get()).toBe('https://kaiju.example.com');
  });
});

describe('MB_PUBLIC_URL', () => {
  it('is read, checked and trimmed to the site address', () => {
    expect(configFromEnv({}).publicUrl).toBeNull();
    expect(configFromEnv({ MB_PUBLIC_URL: '' }).publicUrl).toBeNull();
    expect(configFromEnv({ MB_PUBLIC_URL: '  ' }).publicUrl).toBeNull();
    expect(configFromEnv({ MB_PUBLIC_URL: 'https://kaiju.example.com' }).publicUrl).toBe('https://kaiju.example.com');
    expect(configFromEnv({ MB_PUBLIC_URL: ' https://Kaiju.Example.com/ ' }).publicUrl).toBe('https://kaiju.example.com');
    expect(parsePublicUrl('http://192.168.1.20:2567')).toBe('http://192.168.1.20:2567');
  });

  it('refuses anything that is not the plain address of a site', () => {
    for (const bad of [
      'kaiju.example.com',
      'ftp://kaiju.example.com',
      'javascript:alert(1)',
      'https://kaiju.example.com/game',
      'https://kaiju.example.com/?x=1',
      'https://kaiju.example.com/#ABCD',
      'https://user:pass@kaiju.example.com',
      'https://',
    ]) {
      expect(() => configFromEnv({ MB_PUBLIC_URL: bad }), bad).toThrow(/MB_PUBLIC_URL/);
    }
  });
});

/** A GET with a chosen Host header (fetch does not let a caller set one). */
function getWithHost(url: string, path: string, host: string, accept = 'application/json'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(`${url}${path}`, { headers: { host, accept } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('the server learns its public address from the quick tunnel', () => {
  let ts: TestServer;
  const players: Player[] = [];

  beforeAll(async () => {
    ts = await startTestServer();
  });

  afterAll(async () => {
    for (const p of players) await p.leave().catch(() => undefined);
    await ts.server.close();
  });

  const health = async (host = '127.0.0.1'): Promise<{ publicUrl: string | null }> => {
    const res = await getWithHost(ts.url, '/healthz', host);
    expect(res.status).toBe(200);
    return JSON.parse(res.body) as { publicUrl: string | null };
  };

  it('knows none at first, and is not taught by local or made-up hosts', async () => {
    expect((await health()).publicUrl).toBeNull();
    expect((await health('localhost:2567')).publicUrl).toBeNull();
    expect((await health('evil.example.com')).publicUrl).toBeNull();
    expect((await health('words.trycloudflare.com.evil.example')).publicUrl).toBeNull();
    expect((await health('api.trycloudflare.com')).publicUrl).toBeNull();
  });

  it('takes the address from a health check through the tunnel and leaves the lobby without one before', async () => {
    const host = await Player.create(ts.url, options(1));
    players.push(host);
    await until(() => host.lobbies.length > 0, 'the first lobby state');
    expect(host.lobby.publicUrl).toBeUndefined();

    expect((await health('first-words.trycloudflare.com')).publicUrl).toBe('https://first-words.trycloudflare.com');
    expect((await health()).publicUrl).toBe('https://first-words.trycloudflare.com');
    expect(ts.server.health().publicUrl).toBe('https://first-words.trycloudflare.com');

    // The next lobby state carries it.
    const friend = await Player.join(ts.url, host.lobby.code, options(2));
    players.push(friend);
    await until(() => host.lobby.players.length === 2 && friend.lobbies.length > 0, 'both players in the lobby');
    expect(host.lobby.publicUrl).toBe('https://first-words.trycloudflare.com');
    expect(friend.lobby.publicUrl).toBe('https://first-words.trycloudflare.com');
  });

  it('takes the newest address, also from a page load', async () => {
    const page = await getWithHost(ts.url, '/', 'second-words.trycloudflare.com', 'text/html');
    expect(page.status).toBe(200);
    expect((await health()).publicUrl).toBe('https://second-words.trycloudflare.com');
  });
});

describe('a configured public address', () => {
  it('is reported by /healthz and never replaced by the tunnel', async () => {
    // One server per test process is the rule, so this runs after the server above has closed.
    const ts = await startTestServer({ publicUrl: 'https://kaiju.example.com' });
    try {
      const res = await getWithHost(ts.url, '/healthz', 'other-words.trycloudflare.com');
      expect(JSON.parse(res.body)).toMatchObject({ ok: true, publicUrl: 'https://kaiju.example.com' });
      const host = await Player.create(ts.url, options(3));
      await until(() => host.lobbies.length > 0, 'the first lobby state');
      expect(host.lobby.publicUrl).toBe('https://kaiju.example.com');
      await host.leave();
    } finally {
      await ts.server.close();
    }
  });
});
