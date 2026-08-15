import { readFileSync } from 'node:fs'
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
export default {
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: { alias: { chalk: '/src/empty.js', commander: '/src/empty.js' } },
  // signal.js lives in web/shared/ (#238), outside this Vite root. The build
  // bundles it either way, but the dev server refuses to serve files above the
  // root unless they are allow-listed — without this, `npm run dev` 403s on the
  // one module the map, the HUD and the sound engine all depend on.
  server: { fs: { allow: ['..'] } },
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
