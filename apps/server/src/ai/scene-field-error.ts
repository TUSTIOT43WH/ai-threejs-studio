/** Paths are built only from local field names and numeric array indices, never model values. */
export class SceneFieldError extends Error {
  constructor(readonly path: string) { super('Invalid structured scene field'); }
}

export function atField<T>(path: string, work: () => T): T {
  try { return work(); }
  catch (error) {
    const suffix = error instanceof SceneFieldError && error.path
      ? `${error.path.startsWith('[') ? '' : '.'}${error.path}` : '';
    throw new SceneFieldError(`${path}${suffix}`);
  }
}
