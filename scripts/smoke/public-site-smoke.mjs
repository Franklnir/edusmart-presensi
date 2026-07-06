#!/usr/bin/env node

const DEFAULT_URLS = [
  'https://sman3bogor.sismu.biz.id'
]

const urls = String(process.env.SMOKE_PUBLIC_URLS || process.env.SMOKE_BASE_URL || DEFAULT_URLS.join(','))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 20000)
const failures = []
const checkedAssets = new Set()

const fail = (message) => {
  failures.push(message)
  console.error(`[fail] ${message}`)
}

const ok = (message) => {
  console.log(`[ok] ${message}`)
}

const withTimeout = async (promise, label) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`${label} timeout`)), timeoutMs)
  try {
    return await promise(controller.signal)
  } catch (error) {
    fail(`${label}: ${error?.message || error}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

const request = async (url, options = {}) => withTimeout(
  (signal) => fetch(url, {
    ...options,
    signal,
    redirect: options.redirect || 'follow',
    headers: {
      accept: 'text/html,application/json,*/*',
      ...(options.headers || {})
    }
  }),
  `${options.method || 'GET'} ${url}`
)

const assertStatus = (label, response, allowedStatuses) => {
  if (!response) return false
  if (allowedStatuses.includes(response.status)) {
    ok(`${label} -> ${response.status}`)
    return true
  }

  fail(`${label} -> ${response.status}`)
  return false
}

const collectSameOriginAssets = (html, baseUrl) => {
  const base = new URL(baseUrl)
  const assets = new Set()
  const attrPattern = /\b(?:src|href)=["']([^"']+)["']/gi

  for (const match of html.matchAll(attrPattern)) {
    const raw = String(match[1] || '').trim()
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('#')) continue

    let url
    try {
      url = new URL(raw, base)
    } catch {
      continue
    }

    if (url.origin !== base.origin) continue
    if (
      url.pathname.startsWith('/assets/') ||
      url.pathname === '/manifest.webmanifest' ||
      url.pathname === '/favicon.ico'
    ) {
      assets.add(url.toString())
    }
  }

  return [...assets]
}

const assertCsp = (label, response) => {
  const csp = response?.headers?.get('content-security-policy') || ''
  if (!csp) {
    fail(`${label}: CSP header kosong`)
    return
  }

  if (!/default-src\s+'self'/i.test(csp)) {
    fail(`${label}: CSP default-src tidak ketat`)
    return
  }

  if (/script-src[^;]*\*/i.test(csp)) {
    fail(`${label}: CSP script-src masih wildcard`)
    return
  }

  ok(`${label}: CSP tersedia dan ketat`)
}

const checkPage = async (baseUrl, path) => {
  const url = new URL(path, baseUrl).toString()
  const response = await request(url)
  if (!assertStatus(url, response, [200])) return

  assertCsp(url, response)
  const html = await response.text()
  const assets = collectSameOriginAssets(html, url)

  for (const assetUrl of assets) {
    if (checkedAssets.has(assetUrl)) continue
    checkedAssets.add(assetUrl)
    const assetResponse = await request(assetUrl, { method: 'GET' })
    assertStatus(`asset ${assetUrl}`, assetResponse, [200])
  }
}

const checkCsrf = async (baseUrl) => {
  const url = new URL('/sanctum/csrf-cookie', baseUrl).toString()
  const response = await request(url, { method: 'GET' })
  if (!assertStatus(url, response, [204])) return

  const cookies = response.headers.get('set-cookie') || ''
  if (cookies.includes('XSRF-TOKEN') && cookies.includes('laravel-session')) {
    ok(`${url}: CSRF/session cookie tersedia`)
  } else {
    fail(`${url}: CSRF/session cookie tidak lengkap`)
  }
}

const checkJsonEndpoint = async (baseUrl, path) => {
  const url = new URL(path, baseUrl).toString()
  const response = await request(url, {
    headers: { accept: 'application/json' }
  })
  if (!assertStatus(url, response, [200])) return

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    ok(`${url}: content-type JSON`)
  } else {
    fail(`${url}: content-type bukan JSON (${contentType || 'kosong'})`)
  }
}

const checkCloudflareRum = async (baseUrl) => {
  const url = new URL('/cdn-cgi/rum', baseUrl).toString()
  const response = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  })
  assertStatus(url, response, [200, 202, 204])
}

for (const baseUrl of urls) {
  console.log(`\n== ${baseUrl} ==`)
  await checkPage(baseUrl, '/')
  await checkPage(baseUrl, '/login')
  await checkCsrf(baseUrl)
  await checkJsonEndpoint(baseUrl, '/api/health')
  await checkJsonEndpoint(baseUrl, '/api/public/settings')
  await checkCloudflareRum(baseUrl)
}

if (failures.length > 0) {
  console.error(`\nSmoke check gagal: ${failures.length} masalah.`)
  process.exit(1)
}

console.log('\nSmoke check publik lulus.')
