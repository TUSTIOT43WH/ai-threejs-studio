import { registerHooks } from 'node:module';

// Run the export tests offline with Node's built-in TypeScript stripping.
// Production source uses Vite-style extensionless relative imports.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z\d]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
