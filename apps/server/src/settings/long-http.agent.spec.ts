import { lookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { Agent } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LongHttpAgent, publicApiLookup, type LongHttpRequestInit } from './long-http.agent';

vi.mock('node:dns', () => ({ lookup: vi.fn() }));
const resolver = vi.mocked(lookup);
const v4 = { address: '8.8.8.8', family: 4 };
const v6 = { address: '2606:4700:4700::1111', family: 6 };
type Resolution = { error: NodeJS.ErrnoException | null; address: string | LookupAddress[]; family?: number };

function respond(addresses: LookupAddress[], error: NodeJS.ErrnoException | null = null): void {
  resolver.mockImplementation(((_hostname: string, _options: LookupOptions, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => {
    queueMicrotask(() => callback(error, addresses));
  }) as typeof lookup);
}

function resolve(options?: LookupOptions | number, hostname = 'api.custom-provider.com'): Promise<Resolution> {
  return new Promise((done) => {
    const callback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => done({ error, address, family });
    if (options === undefined) publicApiLookup(hostname, callback);
    else publicApiLookup(hostname, options, callback);
  });
}

describe('socket-time public API DNS lookup (stubbed DNS, no paid requests)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('supports the default single-address callback and resolves all answers exactly once', async () => {
    respond([v4, v6]);
    expect(await resolve()).toEqual({ error: null, address: v4.address, family: 4 });
    expect(resolver).toHaveBeenCalledExactlyOnceWith('api.custom-provider.com', { family: 0, hints: 0, all: true }, expect.any(Function));
  });

  it.each([0, 4, 6, 'IPv4', 'IPv6'] as const)('supports all callbacks with family %s only after validating both families', async (family) => {
    respond([v4, v6]);
    const result = await resolve({ all: true, family, hints: 32, order: 'verbatim' });
    expect(result).toEqual({ error: null, address: family === 4 || family === 'IPv4' ? [v4] : family === 6 || family === 'IPv6' ? [v6] : [v4, v6], family: undefined });
    expect(resolver).toHaveBeenCalledExactlyOnceWith('api.custom-provider.com', { family: 0, hints: 0, all: true, order: 'verbatim' }, expect.any(Function));
  });

  it.each([4, 6])('supports numeric family %s and single-address callbacks', async (family) => {
    respond([v6, v4]);
    expect(await resolve(family)).toEqual({ error: null, address: family === 4 ? v4.address : v6.address, family });
  });

  it.each([
    [{ address: '127.0.0.1', family: 4 }],
    [v4, { address: '10.0.0.1', family: 4 }],
    [{ address: '169.254.169.254', family: 4 }, v4],
    [v4, { address: '::ffff:127.0.0.1', family: 6 }],
    [v6, { address: '192.168.1.1', family: 4 }],
    [v4, { address: 'fd00::1', family: 6 }],
    [v4, { address: '198.18.0.1', family: 4 }],
    [v4, { address: 'garbage', family: 4 }],
    [v4, { address: v6.address, family: 0 }],
  ])('rejects the entire answer set containing any unsafe address: %j', async (...addresses) => {
    respond(addresses);
    for (const options of [{ all: true }, { family: 4 }, { family: 6, all: true }]) {
      const result = await resolve(options);
      expect(result.error).toMatchObject({ code: 'EACCES' });
      expect(result.address).toEqual(options.all ? [] : '');
    }
  });

  it('rejects a rebinding on the next resolution instead of caching a successful preflight', async () => {
    respond([v4]);
    expect((await resolve()).error).toBeNull();
    respond([{ address: '127.0.0.1', family: 4 }]);
    expect((await resolve()).error).toMatchObject({ code: 'EACCES' });
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('connect.lookup blocks rebound DNS during real fetch before a socket can connect', async () => {
    respond([v4]);
    expect((await resolve()).error).toBeNull();
    respond([{ address: '127.0.0.1', family: 4 }]);
    const agent = new LongHttpAgent();
    try {
      const init: LongHttpRequestInit = { dispatcher: agent, redirect: 'error' };
      await expect(fetch('https://api.custom-provider.com/v1', init)).rejects.toMatchObject({ cause: { code: 'EACCES' } });
      expect(resolver).toHaveBeenCalledTimes(2);
    } finally { await agent.destroy(); }
  });

  it('propagates DNS failures and fails closed on empty or nonmatching answers', async () => {
    const error = Object.assign(new Error('DNS unavailable'), { code: 'EAI_AGAIN' });
    respond([], error);
    expect((await resolve({ all: true })).error).toBe(error);
    respond([]);
    expect((await resolve()).error).toMatchObject({ code: 'ENOTFOUND' });
    respond([v4]);
    expect((await resolve({ family: 6 })).error).toMatchObject({ code: 'ENOTFOUND' });
  });

  it.each(['localhost', 'metadata.google.internal', '127.0.0.1', '::1'])('rejects local hostname %s without DNS', async (hostname) => {
    expect((await resolve({}, hostname)).error).toMatchObject({ code: 'EACCES' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('rejects invalid requested families asynchronously without DNS', async () => {
    expect((await resolve(5)).error).toMatchObject({ code: 'EAI_ADDRFAMILY' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('preserves the no-timeout dispatch override even for fetch-supplied limits', async () => {
    const dispatch = vi.spyOn(Agent.prototype, 'dispatch').mockReturnValue(true);
    const agent = new LongHttpAgent();
    const options = { origin: 'https://api.custom-provider.com', path: '/v1', method: 'POST' as const, headersTimeout: 300000, bodyTimeout: 300000 };
    const handler = {};
    try {
      expect(agent.dispatch(options, handler)).toBe(true);
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({ ...options, headersTimeout: 0, bodyTimeout: 0 }, handler);
      expect(options.headersTimeout).toBe(300000);
    } finally { await agent.destroy(); }
  });
});
