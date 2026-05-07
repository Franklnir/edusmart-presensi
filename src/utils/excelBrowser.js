const EXCEL_SCRIPT_SRC = '/vendor/exceljs.min.js'
const EXCEL_SCRIPT_ATTR = 'data-edusmart-exceljs'
const EXCEL_SCRIPT_INTEGRITY =
  'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz'

let excelJsPromise = null

const getExcelJsGlobal = () => {
  if (typeof window === 'undefined') return null
  const candidate = window.ExcelJS
  if (candidate && typeof candidate.Workbook === 'function') {
    return candidate
  }
  return null
}

const ensureExcelScript = () =>
  new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[${EXCEL_SCRIPT_ATTR}="1"]`)

    if (existing) {
      if (existing.getAttribute('data-loaded') === '1') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Gagal memuat Excel engine')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = EXCEL_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.integrity = EXCEL_SCRIPT_INTEGRITY
    script.crossOrigin = 'anonymous'
    script.setAttribute(EXCEL_SCRIPT_ATTR, '1')
    script.addEventListener(
      'load',
      () => {
        script.setAttribute('data-loaded', '1')
        resolve()
      },
      { once: true }
    )
    script.addEventListener('error', () => reject(new Error('Gagal memuat Excel engine')), { once: true })
    document.head.appendChild(script)
  })

export const loadExcelJsBrowser = async () => {
  const fromGlobal = getExcelJsGlobal()
  if (fromGlobal) return fromGlobal

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Excel engine hanya tersedia di browser')
  }

  if (!excelJsPromise) {
    excelJsPromise = (async () => {
      await ensureExcelScript()
      const loaded = getExcelJsGlobal()
      if (!loaded) {
        throw new Error('Excel engine tidak tersedia setelah script dimuat')
      }
      return loaded
    })()
  }

  return excelJsPromise
}
