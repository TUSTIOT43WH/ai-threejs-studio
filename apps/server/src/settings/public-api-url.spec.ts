import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { SaveChatSettingsDto } from './dto';
import { SaveImageSettingsDto } from './image-settings.dto';
import { isPublicApiUrl, isPublicIpAddress } from './public-api-url';

const publicUrls = [
  'https://api.custom-provider.com:8443/custom/v2',
  'https://api.openai.com:444/v1',
  'https://api.openai.com.other-provider.com/v1',
  'https://ark.cn-beijing.volces.com/api/v3',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'https://api.minimax.io/v1', 'https://api.anthropic.com/v1',
  'https://generativelanguage.googleapis.com/v1beta', 'https://open.bigmodel.cn/api/paas/v4',
  'https://api.deepseek.com/', 'https://custom-provider.com',
  'https://api.custom-provider.com.:65535/v1',
  'HTTPS://API.CUSTOM-PROVIDER.COM:443/v1',
  'https://8.8.8.8:8443/api', 'https://[2606:4700:4700::1111]:8443/v1',
];
const unsafeIps = [
  '0.0.0.0', '0.1.2.3', '10.0.0.1', '127.0.0.1', '127.2.3.4',
  '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1',
  '100.64.0.1', '100.127.255.255', '192.0.0.1', '192.0.2.1', '192.88.99.1',
  '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1',
  '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
  '::', '::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:8.8.8.8',
  '::127.0.0.1', '64:ff9b::a00:1', '64:ff9b:1::a00:1',
  '100::1', '2001:db8::1', '2001::1', '2002:7f00:1::', '3fff::1',
  'fc00::1', 'fd00::1', 'fe80::1', 'fec0::1', 'ff02::1',
];
const unsafeUrls: unknown[] = [
  undefined, null, 123, {}, '',
  'http://api.example.com/v1', 'file:///etc/passwd', '//api.example.com/v1',
  'https:api.example.com/v1', 'https:/api.example.com/v1', 'https:///api.example.com/v1',
  'https:////api.example.com/v1', 'https://api.example.com\\@127.0.0.1/v1',
  'https://user:pass@api.example.com/v1', 'https://@api.example.com/v1',
  'https://api.example.com@127.0.0.1/v1', 'https://user%40name@api.example.com/v1',
  'https://%31%32%37.0.0.1/v1', 'https://%61pi.example.com/v1',
  ' https://api.example.com/v1', 'https://api.example.com/v1 ',
  'https://api.exam\tple.com/v1', 'https://api.example.com/\r\nv1',
  'https://api.example.com/\x00v1', 'https://api.example.com/\x7fv1',
  'https://api.example.com/%0d%0aHeader:value', 'https://api.example.com/%250a',
  'https://api.example.com/%00', 'https://api.example.com/%C2%85',
  'https://api.example.com/v1#', 'https://api.example.com/v1#https://127.0.0.1',
  'https://api.example.com/v1/../private', 'https://api.example.com/./v1',
  'https://api.example.com/v1/%2e%2e/private', 'https://api.example.com/v1/%252e%252e/private',
  'https://api.example.com/v1//', 'https://api.example.com//127.0.0.1',
  'https://api.example.com/%2f%2f127.0.0.1', 'https://api.example.com/%252f%252f127.0.0.1',
  'https://api.example.com/%5c127.0.0.1', 'https://api.example.com/https://127.0.0.1',
  'https://api.example.com:0/v1', 'https://api.example.com:65536/v1',
  'https://localhost/v1', 'https://localhost./v1', 'https://api.localhost/v1',
  'https://server/v1', 'https://printer.local/v1', 'https://server.localdomain/v1',
  'https://api.lan/v1', 'https://api.home.arpa/v1', 'https://metadata.google.internal/v1',
  'https://service.onion/v1', 'https://api.invalid/v1', 'https://service.test/v1',
  'https://2130706433/v1', 'https://0x7f000001/v1', 'https://0177.0.0.1/v1',
  'https://127.1/v1', 'https://134744072/v1', 'https://8.8.8.8./v1',
  'https://[fe80::1%25eth0]/v1',
  `https://api.example.com/${'a'.repeat(2048)}`,
  ...unsafeIps.map((ip) => `https://${ip.includes(':') ? `[${ip}]` : ip}/v1`),
];

describe('public API URL contract (no DNS preflight or network)', () => {
  it.each(publicUrls)('accepts arbitrary public HTTPS URL %s', (url) => {
    expect(isPublicApiUrl(url)).toBe(true);
    for (const dto of [
      Object.assign(new SaveChatSettingsDto(), { enabled: false, modelingEnabled: false, baseURL: url, model: 'vendor/arbitrary-model' }),
      Object.assign(new SaveImageSettingsDto(), { enabled: false, baseURL: url, model: 'vendor/arbitrary-model' }),
    ]) expect(validateSync(dto)).toEqual([]);
  });

  it.each(unsafeUrls)('rejects unsafe URL %s even with query opt-in', (value) => {
    expect(isPublicApiUrl(value)).toBe(false);
    expect(isPublicApiUrl(value, true)).toBe(false);
  });

  it.each(['?redirect=https://127.0.0.1', '?url=https%3A%2F%2F10.0.0.1', '?', '?key=secret'])('never accepts config queries %s', (query) => {
    const baseURL = `https://api.example.com/v1${query}`;
    expect(isPublicApiUrl(baseURL)).toBe(false);
    for (const dto of [
      Object.assign(new SaveChatSettingsDto(), { enabled: false, modelingEnabled: false, baseURL, model: 'any' }),
      Object.assign(new SaveImageSettingsDto(), { enabled: false, baseURL, model: 'any' }),
    ]) expect(validateSync(dto).some((error) => error.property === 'baseURL')).toBe(true);
  });

  it('allows signed image query strings only when opted in, without weakening the other checks', () => {
    const signed = 'https://images.custom-provider.com:8443/render/photo%20one.png?X-Amz-Credential=account%2Fregion&signature=a%2Bb%2Fc%3D&expires=123';
    expect(isPublicApiUrl(signed)).toBe(false);
    expect(isPublicApiUrl(signed, true)).toBe(true);
    for (const url of [
      `${signed}#fragment`, signed.replace('images.custom-provider.com', '127.0.0.1'),
      signed.replace('images.custom-provider.com', 'user:pass@images.custom-provider.com'),
      `${signed}&x=%0d%0aHeader`, `${signed}&x=%250a`,
    ]) expect(isPublicApiUrl(url, true)).toBe(false);
  });

  it('accepts the exact 2048-character boundary, rejecting any longer URL', () => {
    const prefix = 'https://api.example.com/';
    const url = prefix + 'a'.repeat(2048 - prefix.length);
    expect(isPublicApiUrl(url)).toBe(true);
    expect(isPublicApiUrl(`${url}a`)).toBe(false);
  });

  it('exposes optional DTO defaults without a vendor or model allowlist', () => {
    expect(new SaveChatSettingsDto()).toMatchObject({ protocol: 'openai', jsonMode: false, tokenParameter: 'max_tokens', maxOutputTokens: 10000 });
    expect(new SaveImageSettingsDto()).toMatchObject({ protocol: 'openai', size: '', responseFormat: 'auto' });
  });
});

describe('shared public unicast address policy', () => {
  it.each(unsafeIps)('rejects special address %s', (ip) => { expect(isPublicIpAddress(ip)).toBe(false); });
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])('accepts public address %s', (ip) => {
    expect(isPublicIpAddress(ip)).toBe(true);
  });
});
