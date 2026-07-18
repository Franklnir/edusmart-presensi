import fs from 'node:fs'

const routePrefetchSource = fs.readFileSync('src/lib/routePrefetch.js', 'utf8')
const routerSource = fs.readFileSync('src/router.jsx', 'utf8')
const indexSource = fs.readFileSync('index.html', 'utf8')

const loaderPaths = new Set(
  Array.from(
    routePrefetchSource.matchAll(/^\s*['"]([^'"]+)['"]:\s*\(\)\s*=>\s*import\(/gm),
    (match) => match[1]
  )
)

const lazyRoutePaths = Array.from(
  routerSource.matchAll(/lazyRoute\(['"]([^'"]+)['"]\)/g),
  (match) => match[1]
)

const missingLoaderPaths = lazyRoutePaths.filter((path) => !loaderPaths.has(path))
if (missingLoaderPaths.length > 0) {
  throw new Error(`Missing lazy route loaders: ${missingLoaderPaths.join(', ')}`)
}

const inlineScripts = Array.from(indexSource.matchAll(/<script\b([^>]*)>/gi))
  .filter((match) => !/\bsrc\s*=/.test(match[1]))

if (inlineScripts.length > 0) {
  throw new Error('index.html contains inline scripts that violate the production CSP')
}

console.log(`Frontend shell check passed (${lazyRoutePaths.length} lazy routes)`)
