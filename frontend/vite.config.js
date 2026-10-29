import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))
const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'

// Signs the dev and preview servers in without a passkey (api/scripts/dev-session.mjs): every
// /api request without our cookie gets DEV_SESSION's, and /__dev-session?c=<value> sets it in one
// browser (the iOS Simulator's home-screen app has its own cookie jar). Never part of a build.
const DEV = process.env.DEV_SESSION?.replace(/^sleepsid=/, '')
const devSession = {
  name: 'dev-session',
  // block bodies: a function returned from these hooks would run as a post-middleware hook
  configureServer(s) { s.middlewares.use(signIn) },
  configurePreviewServer(s) { s.middlewares.use(signIn) }
}
function signIn(req, res, next) {
  if (req.url.startsWith('/__dev-session')) {
    const c = new URL(req.url, 'http://x').searchParams.get('c')?.replace(/^sleepsid=/, '')
    res.writeHead(302, { 'Set-Cookie': `sleepsid=${c}; Path=/; Max-Age=15552000; HttpOnly; SameSite=Lax`, Location: '/' })
    return res.end()
  }
  if (DEV && req.url.startsWith('/api') && !/(^|;\s*)sleepsid=/.test(req.headers.cookie || '')) {
    req.headers.cookie = (req.headers.cookie ? req.headers.cookie + '; ' : '') + 'sleepsid=' + DEV
  }
  next()
}

// The service worker's cache is named after the build, so a deploy drops the old one.
let outDir
const swStamp = {
  name: 'sw-stamp',
  apply: 'build',
  configResolved(c) { outDir = resolve(c.root, c.build.outDir) },
  closeBundle() {
    const html = join(outDir, 'index.html'), sw = join(outDir, 'sw.js')
    if (!existsSync(html) || !existsSync(sw)) return
    const stamp = createHash('sha256').update(readFileSync(html)).digest('hex').slice(0, 10)
    writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD__', stamp))
  }
}

const proxy = { '/api': { target: backend, changeOrigin: false } }
export default defineConfig({
  plugins: [react(), devSession, swStamp],
  define: { __APP_VERSION__: JSON.stringify(pkg.version + (process.env.APP_BUILD ? '+' + process.env.APP_BUILD : '+dev')) },
  server: { proxy },
  preview: { proxy },
  test: { environment: 'node', setupFiles: ['src/test-setup.js'] }
})
