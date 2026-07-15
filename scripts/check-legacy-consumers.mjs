import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const sourceRoot = join(root, 'src')
const registryPath = join(root, 'config', 'api-legacy-consumers.json')
const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
const entries = Array.isArray(registry.entries) ? registry.entries : []
const byFile = new Map(entries.map((entry) => [entry.file, entry]))
const allowedExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.md'])
const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name)
  if (entry.isDirectory()) return walk(path)
  return allowedExtensions.has(entry.name.slice(entry.name.lastIndexOf('.'))) ? [path] : []
})

if (!existsSync(sourceRoot) || !existsSync(registryPath)) {
  console.error('Legacy consumer guard failed: source or registry is missing')
  process.exit(1)
}

const patterns = [
  /supabase\s*\.\s*(?:from|rpc)\s*\(/s,
  /supabase\s*\.\s*batch\s*\(/s,
  /\/api\/db(?:\/batch)?(?:[/'"`?]|$)/s,
  /\bapi\/db(?:\/batch)?\b/s
]
const violations = []
const seen = new Set()

for (const file of walk(sourceRoot)) {
  const relativePath = relative(root, file).replaceAll('\\', '/')
  const contents = readFileSync(file, 'utf8')
  const matched = patterns.some((pattern) => pattern.test(contents))
  if (!matched) continue
  seen.add(relativePath)
  if (!byFile.has(relativePath)) violations.push(`${relativePath}: legacy reference is not registered`)
}

for (const entry of entries) {
  if (!entry.domain || !entry.file || !entry.owner || !entry.operation || !entry.reason || !entry.migration_target || !entry.review_date && !registry.review_date) {
    violations.push(`${entry.file || '<unknown>'}: registry entry is incomplete`)
  }
  if (!seen.has(entry.file) && entry.domain !== 'documentation') {
    console.warn(`Legacy consumer registry entry is currently not matched: ${entry.file}`)
  }
}

if (violations.length) {
  console.error('Legacy consumer guard failed:')
  violations.forEach((violation) => console.error(`- ${violation}`))
  process.exit(1)
}

console.log(`Legacy consumer guard passed: ${seen.size} registered source files reviewed.`)
