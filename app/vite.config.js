import { readFileSync } from 'node:fs'
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
export default {
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: { alias: { chalk: '/src/empty.js', commander: '/src/empty.js' } },
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
