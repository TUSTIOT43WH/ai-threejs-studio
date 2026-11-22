import { lookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { Agent, type Dispatcher } from 'undici';
import { isPublicApiUrl, isPublicIpAddress } from './public-api-url';

export type LongHttpRequestInit = RequestInit & { dispatcher?: Dispatcher };
type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** Resolve once at socket creation, validate every answer, then hand those exact IPs to Node. */
export function publicApiLookup(
  hostname: string,
  options: LookupOptions | number | LookupCallback,
  callback?: LookupCallback,
): void {
  const requested = typeof options === 'function' ? {} : typeof options === 'number' ? { family: options } : options;
  const done = typeof options === 'function' ? options : callback!;
  const fail = (error: NodeJS.ErrnoException) => {
    if (requested.all) done(error, []);
    else done(error, '', 0);
  };
  const blocked = () => Object.assign(new Error('API endpoint must resolve only to public unicast addresses.'), { code: 'EACCES' });
  if (!isPublicApiUrl(`https://${hostname.includes(':') ? `[${hostname}]` : hostname}`)) {
    queueMicrotask(() => fail(blocked()));
    return;
  }
  const family = requested.family === 'IPv4' ? 4 : requested.family === 'IPv6' ? 6 : requested.family ?? 0;
  if (![0, 4, 6].includes(family)) {
    queueMicrotask(() => fail(Object.assign(new Error('Unsupported address family.'), { code: 'EAI_ADDRFAMILY' })));
    return;
  }
  // Inspect both families even if the caller wants just one. Do not let hints
  // suppress unsafe answers or do a second lookup after checking a preflight.
  lookup(hostname, { ...requested, family: 0, hints: 0, all: true }, (error, addresses) => {
    if (error) { fail(error); return; }
    if (addresses.some(({ address, family: resultFamily }) => !isPublicIpAddress(address)
      || (resultFamily !== 4 && resultFamily !== 6))) {
      fail(blocked());
      return;
    }
    const selected = addresses.filter((address) => !family || address.family === family);
    if (!selected.length) {
      fail(Object.assign(new Error('API endpoint has no usable public address.'), { code: 'ENOTFOUND' }));
      return;
    }
    if (requested.all) done(null, selected);
    else done(null, selected[0].address, selected[0].family);
  });
}

/** Shared provider agent. Connection establishment keeps Undici's bounded default. */
export class LongHttpAgent extends Agent {
  constructor() {
    super({ headersTimeout: 0, bodyTimeout: 0, connect: { lookup: publicApiLookup } });
  }

  override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    // Node fetch supplies five-minute per-request defaults that override Agent defaults.
    return super.dispatch({ ...options, headersTimeout: 0, bodyTimeout: 0 }, handler);
  }
}
