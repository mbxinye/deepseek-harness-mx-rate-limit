/**
 * Client bundle for the settings page.
 *
 * The harness ships `packages/client/tsdown.client.ts` for this, but it locates
 * a package by globbing the two-level package directory layout under its own
 * repository root and throws for anything it cannot find there — so a plugin
 * outside that tree cannot use it. This reproduces the part that matters: the
 * artifact shape the browser's module loader expects, and the rule that decides
 * what stays an import.
 *
 * Plain JavaScript on purpose. tsdown's `--config-loader tsx` cannot load a
 * config that reaches for a `node:` builtin, and nothing here needs types.
 *
 * Shape, from `clientConfig` in the harness preset:
 *
 *   intro:  var module = { exports: {} }; var exports = module.exports;
 *   banner: window.__ModuleLoader__.load({ id, factory: (require) => {
 *   footer: return module.exports; } });
 *
 * Externals resolve through the injected `require` against the loader's module
 * table, so a requested specifier must stay an import and everything else has to
 * inline: a require the table cannot answer is a runtime throw. The request list
 * is the platform baseline plus this package's `dsh.client.external`, and the
 * two must agree — a specifier listed in only one place would either inline by
 * accident or import a row the table cannot satisfy.
 */
import { defineConfig } from 'tsdown'

const id = 'dsh-mx-rate-limit'

/** The module-table rows the shell freezes for every client bundle. */
const PLATFORM_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** Rows this package asks for beyond the baseline; mirrors package.json. */
const REQUESTED = new Set([
  ...PLATFORM_MODULES,
  '@deepseek-ai/dsh-client-locale/client',
  '@deepseek-ai/dsh-client-ui-settings/client',
  '@deepseek-ai/dsh-client-ui-plugin-manager/client',
  '@deepseek-ai/dsh-client-ui-renderer/client',
])

/**
 * Refuse a cross-plugin value import this package cannot have.
 *
 * Inlining one would put a second copy of that module's runtime identity in the
 * bundle, so two instances of the same service would not be the same service.
 * Collaboration goes through cordis instead; a type-only import is erased before
 * this ever sees it.
 * @param {string} specifier - the bare specifier being resolved.
 * @returns nothing, to let the default resolver handle it.
 */
function rejectForeignValueImport(specifier) {
  if (typeof specifier !== 'string' || !specifier.startsWith('@deepseek-ai/')) return null
  if (REQUESTED.has(specifier)) return null
  // Vendored libraries carry no shared runtime identity, so inlining is correct.
  if (/^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/.test(specifier)) return null
  throw new Error(
    `client bundle purity: "${specifier}" is not a module-table row this package requests. `
    + 'Cross-plugin value imports are forbidden; use a type-only import, or collaborate through a cordis service.',
  )
}

export default defineConfig({
  name: `${id}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  // `lib/index.js` is the node half and lives in the same directory.
  clean: false,
  fixedExtension: false,
  deps: {
    neverBundle: specifier => REQUESTED.has(specifier),
    alwaysBundle: specifier => !REQUESTED.has(specifier),
  },
  // zustand and friends probe these at module scope; without them defined the
  // browser factory throws ReferenceError at boot.
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [
    {
      name: 'mx-client-purity',
      resolveId: { order: 'pre', handler: rejectForeignValueImport },
    },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    chunkFileNames: 'client.[name].js',
    banner: chunk => `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, ${
      chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `
    }factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})