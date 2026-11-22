import type { NextFunction, Request, Response } from 'express';

export const LOCAL_CLIENT_HEADER = 'x-studio-client';
export const LOCAL_CLIENT_VALUE = 'local-ui';

export function localOrigins(port: number): Set<string> {
  return new Set([port, 5173, 4173].flatMap((value) => [
    `http://localhost:${value}`,
    `http://127.0.0.1:${value}`,
    `http://[::1]:${value}`,
  ]));
}

/** Local single-user boundary, NOT authentication against other local programs. */
export function localApiSecurity(port: number) {
  const origins = localOrigins(port);
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (
      !hosts.has(req.headers.host ?? '') ||
      (origin !== undefined && !origins.has(origin)) ||
      req.headers['sec-fetch-site'] === 'cross-site' ||
      (unsafe && req.headers[LOCAL_CLIENT_HEADER] !== LOCAL_CLIENT_VALUE)
    ) {
      res.status(403).json({ statusCode: 403, message: 'Only trusted local Studio requests are allowed.' });
      return;
    }
    next();
  };
}
