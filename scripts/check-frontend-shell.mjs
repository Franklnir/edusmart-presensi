import fs from 'node:fs'

const routePrefetchSource = fs.readFileSync('src/lib/routePrefetch.js', 'utf8')
const routerSource = fs.readFileSync('src/router.jsx', 'utf8')
const indexSource = fs.readFileSync('index.html', 'utf8')
const productionWorkflowSource = fs.readFileSync(
  '.github/workflows/cloudflare-pages-production.yml',
  'utf8'
)
const productionImageWorkflowSource = fs.readFileSync('.github/workflows/ci.yml', 'utf8')

const readFrontendSources = (directory) => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return readFrontendSources(path)
    if (!entry.isFile() || !/\.(?:js|jsx)$/.test(entry.name)) return []
    return [fs.readFileSync(path, 'utf8')]
  })

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

const usedV2Flags = new Set(
  Array.from(
    readFrontendSources('src').join('\n').matchAll(/VITE_USE_[A-Z0-9_]+_V2/g),
    (match) => match[0]
  )
)

const missingProductionV2Flags = Array.from(usedV2Flags)
  .filter((flag) => !productionWorkflowSource.includes(`${flag}: "true"`))

if (missingProductionV2Flags.length > 0) {
  throw new Error(
    `Production Cloudflare V2 flags are missing or disabled: ${missingProductionV2Flags.join(', ')}`
  )
}

const missingImageV2Flags = Array.from(usedV2Flags)
  .filter((flag) => !productionImageWorkflowSource.includes(`${flag}: "true"`))

if (missingImageV2Flags.length > 0) {
  throw new Error(
    `Production image V2 flags are missing or disabled: ${missingImageV2Flags.join(', ')}`
  )
}

console.log(
  `Frontend shell check passed (${lazyRoutePaths.length} lazy routes, ${usedV2Flags.size} V2 flags)`
)
