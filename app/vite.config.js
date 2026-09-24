import { readFileSync } from 'node:fs'
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
export default {
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: { alias: { chalk: '/src/empty.js', commander: '/src/empty.js' } },
  // MapLibre in a chunk of its own (#617): its hash changes only with the
  // MapLibre version, so a deploy of app code does not make every phone fetch
  // the 1.2 MB of map library again, as the unpkg copy never did.
  build: { rollupOptions: { output: { manualChunks: { maplibre: ['maplibre-gl'] } } } },
  // Emit /version.json (served no-cache, see nginx.conf) so a running instance
  // can spot a newer deploy and offer a reload — see update.js / the Settings
  // reload button.
  plugins: [{
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: pkg.version }) })
    },
  }],
}
