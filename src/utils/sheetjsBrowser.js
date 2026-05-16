const SHEETJS_SCRIPT_SRC = '/vendor/xlsx.full.min.js'
const SHEETJS_SCRIPT_ATTR = 'data-edusmart-sheetjs'
const SHEETJS_SCRIPT_INTEGRITY =
  'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT'

let sheetJsPromise = null

const getSheetJsGlobal = () => {
  if (typeof window === 'undefined') return null
  const candidate = window.XLSX
  if (
    candidate &&
    typeof candidate.read === 'function' &&
    typeof candidate.utils?.sheet_to_json === 'function'
  ) {
    return candidate
  }
  return null
}

const ensureSheetJsScript = () =>
  new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[${SHEETJS_SCRIPT_ATTR}="1"]`)

    if (existing) {
      if (existing.getAttribute('data-loaded') === '1') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Gagal memuat spreadsheet engine')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = SHEETJS_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.integrity = SHEETJS_SCRIPT_INTEGRITY
    script.crossOrigin = 'anonymous'
    script.setAttribute(SHEETJS_SCRIPT_ATTR, '1')
    script.addEventListener(
      'load',
      () => {
        script.setAttribute('data-loaded', '1')
        resolve()
      },
      { once: true }
    )
    script.addEventListener('error', () => reject(new Error('Gagal memuat spreadsheet engine')), { once: true })
    document.head.appendChild(script)
  })

export const loadSheetJsBrowser = async () => {
  const fromGlobal = getSheetJsGlobal()
  if (fromGlobal) return fromGlobal

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Spreadsheet engine hanya tersedia di browser')
  }

  if (!sheetJsPromise) {
    sheetJsPromise = (async () => {
      await ensureSheetJsScript()
      const loaded = getSheetJsGlobal()
      if (!loaded) {
        throw new Error('Spreadsheet engine tidak tersedia setelah script dimuat')
      }
      return loaded
    })()
  }

  return sheetJsPromise
}
