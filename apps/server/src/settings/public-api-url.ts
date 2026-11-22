import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

/** Use the same address policy for URL literals and socket-time DNS answers. */
export function isPublicIpAddress(address: string): boolean {
  if (!isIP(address)) return false;
  try {
    const parsed = ipaddr.parse(address);
    // Mapped/translated IPv4, multicast, documentation and other special ranges
    // are not ordinary public unicast destinations, even when syntactically valid.
    if (parsed.range() !== 'unicast') return false;
    // Unallocated IPv6 space is not public routing space either.
    return parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::'), 3);
  } catch {
    return false;
  }
}

const controls = /[\x00-\x1f\x7f-\x9f]/u;
const localSuffix = /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|home\.arpa|onion|invalid|test)$/i;

function safeEncoding(value: string, path: boolean): boolean {
  // Check nested encodings too, without rewriting the URL sent to the provider.
  for (;;) {
    if (controls.test(value) || value.includes('\\')) return false;
    if (path && (/\/\//.test(value) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value) || /%2f|%5c/i.test(value))) return false;
    let decoded: string;
    try { decoded = decodeURIComponent(value); } catch { return false; }
    if (decoded === value) return true;
    value = decoded;
    // A decoded literal percent need not itself introduce another escape.
    if (!/%[\da-f]{2}/i.test(value)) {
      return !controls.test(value) && !value.includes('\\')
        && (!path || (!value.includes('//') && !/(?:^|\/)\.{1,2}(?:\/|$)/.test(value)));
    }
  }
}

/** Syntax validation only; socket-time DNS enforcement requires LongHttpAgent. */
export function isPublicApiUrl(value: unknown, allowQuery = false): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048
    || /\s/u.test(value) || controls.test(value) || value.includes('\\') || value.includes('#')
    || (!allowQuery && value.includes('?'))) return false;
  const parts = /^https:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?$/i.exec(value);
  if (!parts) return false;
  const [, authority, path, query] = parts;
  // Reject even empty userinfo, percent-encoded hosts and IPv6 zone identifiers.
  if (/[@%]/.test(authority) || !safeEncoding(path, true) || (query !== undefined && !safeEncoding(query, false))) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port === '0') return false;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(hostname)) {
      // WHATWG normalizes decimal, octal, hexadecimal and abbreviated IPv4.
      // Do not let those ambiguous literals bypass the literal-address policy.
      const rawHostname = authority.startsWith('[') ? authority.slice(1, authority.indexOf(']')) : authority.split(':')[0];
      if (isIP(hostname) === 4 && rawHostname !== hostname) return false;
      return isPublicIpAddress(hostname);
    }
    const normalized = hostname.replace(/\.$/, '');
    if (normalized.length > 253 || localSuffix.test(normalized)) return false;
    const labels = normalized.split('.');
    return labels.length > 1 && labels.every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label));
  } catch {
    return false;
  }
}
