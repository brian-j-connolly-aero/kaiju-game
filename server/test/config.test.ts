import { DEFAULT_PORT } from '@mb/shared';
import { describe, expect, it } from 'vitest';
import { configFromEnv, defaultConfig, FAST_END_SCREEN_SECONDS } from '../src/config';

describe('server configuration', () => {
  it('has sensible defaults', () => {
    const c = configFromEnv({});
    expect(c.port).toBe(DEFAULT_PORT);
    expect(c.host).toBeUndefined();
    expect(c.fast).toBe(false);
    expect(c.latencyMs).toBe(0);
    expect(c.speed).toBe(1);
    expect(c.graceSeconds).toBeGreaterThanOrEqual(30);
    expect(c.endScreenSeconds).toBeGreaterThan(FAST_END_SCREEN_SECONDS);
    expect(c.clientDir).toBeNull();
  });

  it('reads every variable', () => {
    const c = configFromEnv({
      PORT: '3111',
      HOST: '127.0.0.1',
      MB_FAST: '1',
      MB_LATENCY: '120',
      MB_SPEED: '8',
      MB_GRACE: '12',
      MB_END_SCREEN: '0',
      MB_MAX_ROOMS: '3',
      MB_CLIENT_DIR: '/srv/game',
    });
    expect(c).toMatchObject({
      port: 3111,
      host: '127.0.0.1',
      fast: true,
      latencyMs: 120,
      speed: 8,
      graceSeconds: 12,
      endScreenSeconds: 0,
      maxRooms: 3,
      clientDir: '/srv/game',
    });
  });

  it('shortens the end screen with MB_FAST unless told otherwise', () => {
    expect(configFromEnv({ MB_FAST: '1' }).endScreenSeconds).toBe(FAST_END_SCREEN_SECONDS);
    expect(configFromEnv({ MB_FAST: 'true', MB_END_SCREEN: '45' }).endScreenSeconds).toBe(45);
    expect(configFromEnv({ MB_FAST: '0' }).fast).toBe(false);
    expect(configFromEnv({ MB_FAST: '' }).fast).toBe(false);
    expect(defaultConfig({ fast: true }).endScreenSeconds).toBe(FAST_END_SCREEN_SECONDS);
  });

  it('lets the environment override what the entry point passes in, and keeps the rest', () => {
    const c = configFromEnv({ PORT: '0' }, { clientDir: '/default/dist', handleSignals: true, port: 9 });
    expect(c.port).toBe(0);
    expect(c.clientDir).toBe('/default/dist');
    expect(c.handleSignals).toBe(true);
  });

  it('rejects values that cannot be right instead of guessing', () => {
    expect(() => configFromEnv({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => configFromEnv({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => configFromEnv({ PORT: '25.5' })).toThrow(/PORT/);
    expect(() => configFromEnv({ MB_LATENCY: '-5' })).toThrow(/MB_LATENCY/);
    expect(() => configFromEnv({ MB_SPEED: '0' })).toThrow(/MB_SPEED/);
    expect(() => configFromEnv({ MB_SPEED: '1000' })).toThrow(/MB_SPEED/);
    expect(() => configFromEnv({ MB_GRACE: 'soon' })).toThrow(/MB_GRACE/);
  });
});
