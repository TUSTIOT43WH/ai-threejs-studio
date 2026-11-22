import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { localApiSecurity, localOrigins } from './local-api-security';

function attempt(method: string, headers: Record<string, string>, path = '/api/settings/chat') {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn();
  localApiSecurity(4000)({ method, headers, path } as Request, response as unknown as Response, next);
  return { response, next };
}

const trusted = { host: 'localhost:4000', origin: 'http://localhost:5173', 'x-studio-client': 'local-ui', 'sec-fetch-site': 'same-origin' };

describe('loopback API browser boundary', () => {
  it('allows trusted local writes and preflight', () => {
    expect(attempt('PUT', trusted).next).toHaveBeenCalledOnce();
    expect(attempt('OPTIONS', { host: trusted.host, origin: trusted.origin }).next).toHaveBeenCalledOnce();
    expect(attempt('GET', { host: '127.0.0.1:4000' }, '/api/health').next).toHaveBeenCalledOnce();
  });

  it.each([
    { origin: 'https://evil.example' }, { origin: 'null' },
    { origin: 'http://localhost:5174' }, { origin: 'http://localhost.evil.example:5173' },
    { host: 'evil.example:4000' }, { host: 'localhost:4444' },
    { host: 'localhost:4000.evil.example' }, { 'sec-fetch-site': 'cross-site' },
    { 'x-studio-client': '' },
  ])('rejects untrusted writes even when other headers are correct: %j', (patch) => {
    const { response, next } = attempt('PUT', { ...trusted, ...patch });
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['/api/settings/chat', '/api/settings/chat/test', '/api/projects/p/chat', '/api/projects'])('rejects cross-site or simple POST requests to %s', (path) => {
    for (const headers of [
      { host: 'localhost:4000' },
      { ...trusted, origin: 'https://evil.example' },
      { ...trusted, 'sec-fetch-site': 'cross-site' },
    ]) {
      expect(attempt('POST', headers, path).response.status).toHaveBeenCalledWith(403);
    }
  });

  it('blocks cross-site reads and hostile Host reads, not only mutations', () => {
    expect(attempt('GET', { ...trusted, origin: 'https://evil.example' }).next).not.toHaveBeenCalled();
    expect(attempt('GET', { ...trusted, host: 'rebound.evil.example:4000' }).next).not.toHaveBeenCalled();
  });

  it('permits originless local clients only with a write header, without trusting forwarded hosts', () => {
    expect(attempt('DELETE', { host: trusted.host, 'x-studio-client': 'local-ui' }).next).toHaveBeenCalled();
    expect(attempt('PUT', { ...trusted, host: 'evil.example', 'x-forwarded-host': trusted.host }).next).not.toHaveBeenCalled();
  });

  it('limits CORS origins to explicit loopback web/API ports', () => {
    expect(localOrigins(4000).has('http://localhost:5173')).toBe(true);
    expect(localOrigins(4000).has('http://127.0.0.1:4173')).toBe(true);
    expect(localOrigins(4000).has('http://192.168.1.3:5173')).toBe(false);
    expect(localOrigins(4000).has('null')).toBe(false);
    expect(localOrigins(4000).has('*')).toBe(false);
  });
});
