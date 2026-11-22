import { useEffect, useState } from 'react';
import type { MetaResponse } from '@ai-three-studio/shared';
import { api } from '../lib/api';

let cache: MetaResponse | null = null;
let inflight: Promise<MetaResponse> | null = null;

function loadMeta(): Promise<MetaResponse> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .getMeta()
      .then((meta) => {
        cache = meta;
        return meta;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useMeta(): MetaResponse | null {
  const [meta, setMeta] = useState<MetaResponse | null>(cache);

  useEffect(() => {
    let active = true;
    loadMeta()
      .then((value) => {
        if (active) setMeta(value);
      })
      .catch(() => {
        if (active) setMeta(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return meta;
}
