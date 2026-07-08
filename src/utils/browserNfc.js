export const BROWSER_NFC_VALIDATION_STEPS = [
  { id: 'mobile', label: 'Browser dibuka dari HP Android Chrome' },
  { id: 'secure', label: 'Halaman aman HTTPS dan bukan iframe' },
  { id: 'api', label: 'Web NFC tersedia di browser' },
  { id: 'permission', label: 'Izin NFC dan sensor siap membaca kartu' }
]

export const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

export const initialBrowserNfcChecks = () => BROWSER_NFC_VALIDATION_STEPS.map((step) => ({
  ...step,
  status: 'pending',
  detail: ''
}))

export const detectBrowserNfcEnvironment = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isAndroid: false,
      isChromeAndroid: false,
      isSecure: false,
      isTopLevel: false,
      hasWebNfc: false
    }
  }

  const ua = navigator.userAgent || ''
  const isAndroid = /Android/i.test(ua)
  const isChrome = /Chrome\/\d+/i.test(ua)
  const isExcludedChromium = /EdgA|Edg\/|OPR\/|Opera|SamsungBrowser|Firefox|CriOS|FxiOS/i.test(ua)

  return {
    isAndroid,
    isChromeAndroid: isAndroid && isChrome && !isExcludedChromium,
    isSecure: Boolean(window.isSecureContext),
    isTopLevel: window.self === window.top,
    hasWebNfc: 'NDEFReader' in window
  }
}

export const normalizeBrowserNfcUid = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    const parsed = JSON.parse(raw)
    const parsedUid = parsed?.uid || parsed?.card_uid || parsed?.rfid_uid
    if (parsedUid) return normalizeBrowserNfcUid(parsedUid)
  } catch {
    // Bukan JSON; lanjutkan parsing teks biasa.
  }

  const prefixed = raw.match(/SISMU:UID:([0-9a-z:-]+)/i)
  if (prefixed?.[1]) return normalizeBrowserNfcUid(prefixed[1])

  const queryUid = raw.match(/(?:uid|card_uid|rfid_uid)=([0-9a-z:-]+)/i)
  if (queryUid?.[1]) return normalizeBrowserNfcUid(queryUid[1])

  return raw
    .replace(/^SISMU:UID:/i, '')
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase()
}

export const decodeNdefRecordData = (record) => {
  if (!record?.data) return ''

  try {
    const encoding = record.encoding || 'utf-8'
    return new TextDecoder(encoding).decode(record.data)
  } catch {
    try {
      return new TextDecoder().decode(record.data)
    } catch {
      return ''
    }
  }
}

export const extractBrowserNfcUid = (event) => {
  const candidates = []
  if (event?.serialNumber) candidates.push(event.serialNumber)

  const records = Array.from(event?.message?.records || [])
  records.forEach((record) => {
    const decoded = decodeNdefRecordData(record)
    if (decoded) candidates.unshift(decoded)
  })

  for (const candidate of candidates) {
    const uid = normalizeBrowserNfcUid(candidate)
    if (uid) return uid
  }

  return ''
}
