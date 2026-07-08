import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  CheckCircle,
  Grip,
  Nfc,
  Power,
  RefreshCcw,
  ShieldCheck,
  SmartphoneNfc,
  X,
  XCircle
} from 'lucide-react'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import {
  detectBrowserNfcEnvironment,
  extractBrowserNfcUid,
  initialBrowserNfcChecks,
  wait
} from '../../utils/browserNfc'

const BrowserNfcContext = createContext(null)

const DEFAULT_PANEL_OPTIONS = {
  canStart: false,
  inactiveMessage: 'Buka Live Scan dan aktifkan scan harian realtime atau mode scan manual dulu.'
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const getInitialFloatingPosition = () => {
  if (typeof window === 'undefined') return { x: 24, y: 420 }

  try {
    const stored = JSON.parse(window.localStorage.getItem('sismu_browser_nfc_floating_position') || 'null')
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      return {
        x: clamp(stored.x, 8, window.innerWidth - 64),
        y: clamp(stored.y, 8, window.innerHeight - 64)
      }
    }
  } catch {
    // ignore
  }

  return {
    x: Math.max(16, window.innerWidth - 84),
    y: Math.max(96, window.innerHeight - 148)
  }
}

const statusMetaFor = (status) => {
  if (status === 'active') {
    return {
      label: 'Online',
      badge: 'bg-emerald-600 text-white',
      card: 'border-emerald-200 bg-emerald-50/60',
      dot: 'animate-pulse bg-white',
      icon: Nfc
    }
  }

  if (status === 'validating') {
    return {
      label: 'Validasi',
      badge: 'bg-blue-600 text-white',
      card: 'border-blue-200 bg-blue-50/60',
      dot: 'animate-pulse bg-white',
      icon: ShieldCheck
    }
  }

  if (status === 'error') {
    return {
      label: 'Tidak siap',
      badge: 'bg-rose-100 text-rose-700',
      card: 'border-rose-200 bg-rose-50/60',
      dot: 'bg-rose-500',
      icon: XCircle
    }
  }

  return {
    label: 'Offline',
    badge: 'bg-rose-100 text-rose-700',
    card: 'border-gray-200 bg-gray-50',
    dot: 'bg-rose-500',
    icon: SmartphoneNfc
  }
}

function BrowserNfcPanel({
  activeOwnerName,
  checks,
  closePanel,
  lastUid,
  message,
  panelOptions,
  readCount,
  start,
  status,
  stop
}) {
  const statusMeta = statusMetaFor(status)
  const StatusIcon = statusMeta.icon
  const canStart = panelOptions.canStart
  const isActive = status === 'active'
  const isValidating = status === 'validating'
  const actionDisabled = isValidating || (!isActive && !canStart)

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
              <StatusIcon className={`h-6 w-6 ${isValidating ? 'animate-pulse' : ''}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-600">
                Reader NFC Browser
              </p>
              <h2 className="text-xl font-bold text-slate-950">
                Alat RFID versi HP Browser
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {message}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closePanel}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Tutup panel NFC browser"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className={`rounded-xl border p-4 ${statusMeta.card}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-950">
                    Browser NFC Reader
                  </p>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusMeta.badge}`}>
                    <span className={`h-2 w-2 rounded-full ${statusMeta.dot}`} />
                    {statusMeta.label}
                  </span>
                </div>
                <p className="mt-1 break-all font-mono text-xs text-slate-500">
                  WEB_NFC_BROWSER
                </p>
              </div>

              <button
                type="button"
                onClick={isActive ? () => stop({ notify: true }) : () => start(panelOptions)}
                disabled={actionDisabled}
                className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  isActive
                    ? 'border border-rose-200 bg-white text-rose-700 hover:bg-rose-50'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isValidating ? (
                  <RefreshCcw className="h-4 w-4 animate-spin" />
                ) : isActive ? (
                  <Power className="h-4 w-4" />
                ) : (
                  <SmartphoneNfc className="h-4 w-4" />
                )}
                {isValidating ? 'Memvalidasi...' : isActive ? 'Matikan NFC Browser' : 'Aktifkan NFC Browser'}
              </button>
            </div>

            {!canStart && !isActive && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                {panelOptions.inactiveMessage}
              </p>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-white px-3 py-2">
                <p className="text-[11px] font-semibold uppercase text-slate-500">Pemilik akun</p>
                <p className="mt-1 truncate text-sm font-semibold text-slate-950">
                  {activeOwnerName || '-'}
                </p>
              </div>
              <div className="rounded-lg bg-white px-3 py-2">
                <p className="text-[11px] font-semibold uppercase text-slate-500">Scan dari HP</p>
                <p className="mt-1 text-sm font-semibold text-slate-950">
                  {readCount} kartu terbaca
                </p>
              </div>
            </div>

            {lastUid && (
              <div className="mt-3 rounded-lg bg-white px-3 py-2">
                <p className="text-[11px] font-semibold uppercase text-slate-500">UID terakhir</p>
                <p className="mt-1 break-all font-mono text-sm font-semibold text-slate-950">
                  {lastUid}
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {checks.map((step) => {
              const isChecking = step.status === 'checking'
              const isOk = step.status === 'ok'
              const isFail = step.status === 'fail'

              return (
                <div
                  key={step.id}
                  className={`flex items-start gap-2 rounded-lg border bg-white px-3 py-2 text-sm ${
                    isOk
                      ? 'border-emerald-200 text-emerald-800'
                      : isFail
                        ? 'border-rose-200 text-rose-800'
                        : isChecking
                          ? 'border-blue-200 text-blue-800'
                          : 'border-slate-200 text-slate-600'
                  }`}
                >
                  {isOk ? (
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : isFail ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  ) : isChecking ? (
                    <RefreshCcw className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-blue-600" />
                  ) : (
                    <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold">{step.label}</div>
                    {step.detail && (
                      <div className="mt-0.5 text-xs opacity-80">{step.detail}</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function BrowserNfcFloatingIndicator({ openPanel, status }) {
  const [position, setPosition] = useState(getInitialFloatingPosition)
  const dragRef = useRef({
    dragging: false,
    moved: false,
    offsetX: 0,
    offsetY: 0
  })

  useEffect(() => {
    const handleResize = () => {
      setPosition((current) => ({
        x: clamp(current.x, 8, window.innerWidth - 64),
        y: clamp(current.y, 8, window.innerHeight - 64)
      }))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem('sismu_browser_nfc_floating_position', JSON.stringify(position))
    } catch {
      // ignore
    }
  }, [position])

  const handlePointerDown = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    dragRef.current = {
      dragging: true,
      moved: false,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = (event) => {
    const drag = dragRef.current
    if (!drag.dragging) return

    const nextX = clamp(event.clientX - drag.offsetX, 8, window.innerWidth - 64)
    const nextY = clamp(event.clientY - drag.offsetY, 8, window.innerHeight - 64)
    if (Math.abs(nextX - position.x) > 2 || Math.abs(nextY - position.y) > 2) {
      drag.moved = true
    }
    setPosition({ x: nextX, y: nextY })
  }

  const handlePointerUp = (event) => {
    const moved = dragRef.current.moved
    dragRef.current.dragging = false
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (!moved) openPanel({ canStart: status === 'active' })
  }

  return (
    <button
      type="button"
      aria-label="Status NFC browser aktif"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="fixed z-[70] flex h-14 w-14 touch-none items-center justify-center rounded-full border border-emerald-200 bg-emerald-600 text-white shadow-2xl ring-4 ring-emerald-100/80 transition hover:bg-emerald-700"
      style={{ left: position.x, top: position.y }}
      title="NFC Browser aktif"
    >
      <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-300" />
      <Nfc className="h-6 w-6" />
      <Grip className="absolute bottom-1 right-1 h-3 w-3 opacity-70" />
    </button>
  )
}

export function BrowserNfcProvider({ children }) {
  const profile = useAuthStore((state) => state.profile)
  const user = useAuthStore((state) => state.user)
  const pushToast = useUIStore((state) => state.pushToast)
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('Belum aktif')
  const [checks, setChecks] = useState(() => initialBrowserNfcChecks())
  const [lastUid, setLastUid] = useState('')
  const [readCount, setReadCount] = useState(0)
  const [lastActiveAt, setLastActiveAt] = useState(null)
  const [activatedBy, setActivatedBy] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelOptions, setPanelOptions] = useState(DEFAULT_PANEL_OPTIONS)
  const abortRef = useRef(null)
  const readerRef = useRef(null)
  const lastReadRef = useRef({ uid: '', at: 0 })
  const readHandlerRef = useRef(null)

  const activeOwnerName = activatedBy?.nama || activatedBy?.name || ''

  const setCheckStatus = useCallback((id, nextStatus, detail = '') => {
    setChecks((current) => current.map((step) => (
      step.id === id ? { ...step, status: nextStatus, detail } : step
    )))
  }, [])

  const stopReader = useCallback(() => {
    try {
      abortRef.current?.abort()
    } catch {
      // ignore
    }
    abortRef.current = null
    readerRef.current = null
    lastReadRef.current = { uid: '', at: 0 }
  }, [])

  const stop = useCallback(({ notify = false, message: stopMessage = 'NFC Browser dimatikan.' } = {}) => {
    stopReader()
    setStatus('idle')
    setMessage('Belum aktif')
    setChecks(initialBrowserNfcChecks())
    setLastUid('')
    setReadCount(0)
    setLastActiveAt(null)
    setActivatedBy(null)
    if (notify) pushToast('info', stopMessage)
  }, [pushToast, stopReader])

  const registerReadHandler = useCallback((handler, options = {}) => {
    const entry = {
      handler,
      enabled: options.enabled !== false,
      inactiveMessage: options.inactiveMessage || DEFAULT_PANEL_OPTIONS.inactiveMessage
    }
    readHandlerRef.current = entry

    return () => {
      if (readHandlerRef.current === entry) {
        readHandlerRef.current = null
      }
    }
  }, [])

  const openPanel = useCallback((options = {}) => {
    setPanelOptions({
      ...DEFAULT_PANEL_OPTIONS,
      ...options
    })
    setPanelOpen(true)
  }, [])

  const closePanel = useCallback(() => {
    setPanelOpen(false)
  }, [])

  const start = useCallback(async (options = {}) => {
    const resolvedOptions = {
      ...DEFAULT_PANEL_OPTIONS,
      ...panelOptions,
      ...options
    }

    if (status === 'active' || status === 'validating') return
    if (!resolvedOptions.canStart) {
      pushToast('error', resolvedOptions.inactiveMessage)
      return
    }

    const env = detectBrowserNfcEnvironment()
    const failValidation = (id, failMessage) => {
      setCheckStatus(id, 'fail', failMessage)
      setStatus('error')
      setMessage(failMessage)
      pushToast('error', failMessage)
    }
    const runStaticCheck = async (id, ok, failMessage) => {
      setCheckStatus(id, 'checking')
      await wait(320)
      if (!ok) {
        failValidation(id, failMessage)
        return false
      }
      setCheckStatus(id, 'ok')
      return true
    }

    stopReader()
    setStatus('validating')
    setMessage('Memvalidasi perangkat dan browser...')
    setChecks(initialBrowserNfcChecks())
    setLastUid('')
    setReadCount(0)
    setActivatedBy({
      id: profile?.id || user?.id || '',
      nama: profile?.nama || user?.email?.split('@')[0] || 'Pengguna aktif',
      role: profile?.role || ''
    })

    if (!await runStaticCheck('mobile', env.isChromeAndroid, 'Browser NFC hanya didukung stabil di Chrome Android. Buka halaman ini dari HP Android dengan Chrome.')) return
    if (!await runStaticCheck('secure', env.isSecure && env.isTopLevel, 'Web NFC wajib memakai HTTPS dan dibuka sebagai halaman utama, bukan iframe.')) return
    if (!await runStaticCheck('api', env.hasWebNfc, 'Browser ini belum menyediakan Web NFC. Gunakan Chrome Android atau reader RFID fisik.')) return

    setCheckStatus('permission', 'checking', 'Menunggu izin NFC dari browser...')
    setMessage('Menunggu izin NFC. Pastikan NFC HP aktif, lalu izinkan saat diminta.')

    try {
      const reader = new window.NDEFReader()
      const controller = new AbortController()
      readerRef.current = reader
      abortRef.current = controller

      await reader.scan({ signal: controller.signal })

      reader.onreading = async (event) => {
        const uid = extractBrowserNfcUid(event)
        if (!uid) {
          setMessage('Kartu terbaca, tapi UID/NDEF kosong.')
          pushToast('warning', 'Kartu terbaca, tapi UID/NDEF kosong.')
          return
        }

        const nowMs = Date.now()
        const lastRead = lastReadRef.current
        if (lastRead.uid === uid && nowMs - lastRead.at < 1500) return
        lastReadRef.current = { uid, at: nowMs }

        const nowIso = new Date().toISOString()
        setLastUid(uid)
        setReadCount((count) => count + 1)
        setLastActiveAt(nowIso)
        setMessage(`Kartu terbaca: ${uid}`)

        const handlerEntry = readHandlerRef.current
        if (handlerEntry?.enabled && typeof handlerEntry.handler === 'function') {
          try {
            await handlerEntry.handler(uid, {
              readAt: nowIso,
              source: 'web_nfc'
            })
          } catch (error) {
            console.error('Browser NFC handler failed:', error)
            pushToast('error', 'Kartu terbaca, tapi gagal diproses ke absensi.')
          }
        } else {
          pushToast('warning', handlerEntry?.inactiveMessage || 'Kartu terbaca. Buka Live Scan untuk memproses absensi.')
        }
      }

      reader.onreadingerror = () => {
        setMessage('Kartu belum bisa dibaca. Tempelkan ulang ke area NFC HP.')
        pushToast('warning', 'Kartu belum bisa dibaca. Tempelkan ulang ke area NFC HP.')
      }

      const activeAt = new Date().toISOString()
      setCheckStatus('permission', 'ok', 'NFC browser aktif')
      setStatus('active')
      setLastActiveAt(activeAt)
      setMessage('Browser NFC aktif. Tempelkan kartu ke belakang HP.')
      pushToast('success', 'Browser NFC aktif. Tempelkan kartu ke belakang HP.')
    } catch (error) {
      stopReader()
      const errorName = String(error?.name || '')
      let errorMessage = error?.message || 'Gagal mengaktifkan Browser NFC.'
      if (errorName === 'NotAllowedError') {
        errorMessage = 'Izin NFC ditolak. Aktifkan izin NFC browser lalu coba lagi.'
      } else if (errorName === 'NotReadableError') {
        errorMessage = 'NFC HP belum aktif atau sensor belum siap. Aktifkan NFC di pengaturan HP lalu coba lagi.'
      } else if (errorName === 'NotSupportedError') {
        errorMessage = 'Web NFC tidak didukung oleh browser/perangkat ini.'
      } else if (errorName === 'AbortError') {
        errorMessage = 'Aktivasi Browser NFC dibatalkan.'
      }

      setCheckStatus('permission', 'fail', errorMessage)
      setStatus('error')
      setMessage(errorMessage)
      pushToast('error', errorMessage)
    }
  }, [
    panelOptions,
    profile?.id,
    profile?.nama,
    profile?.role,
    pushToast,
    setCheckStatus,
    status,
    stopReader,
    user?.email,
    user?.id
  ])

  useEffect(() => () => {
    stopReader()
  }, [stopReader])

  useEffect(() => {
    if (!user?.id && status !== 'idle') {
      stop({ notify: false })
    }
  }, [status, stop, user?.id])

  const value = useMemo(() => ({
    activeOwnerName,
    activatedBy,
    checks,
    closePanel,
    isActive: status === 'active',
    isValidating: status === 'validating',
    lastActiveAt,
    lastUid,
    message,
    openPanel,
    readCount,
    registerReadHandler,
    start,
    status,
    statusMeta: statusMetaFor(status),
    stop
  }), [
    activeOwnerName,
    activatedBy,
    checks,
    closePanel,
    lastActiveAt,
    lastUid,
    message,
    openPanel,
    readCount,
    registerReadHandler,
    start,
    status,
    stop
  ])

  return (
    <BrowserNfcContext.Provider value={value}>
      {children}
      {status === 'active' && (
        <BrowserNfcFloatingIndicator openPanel={openPanel} status={status} />
      )}
      {panelOpen && (
        <BrowserNfcPanel
          activeOwnerName={activeOwnerName}
          checks={checks}
          closePanel={closePanel}
          lastUid={lastUid}
          message={message}
          panelOptions={panelOptions}
          readCount={readCount}
          start={start}
          status={status}
          stop={stop}
        />
      )}
    </BrowserNfcContext.Provider>
  )
}

export const useBrowserNfc = () => {
  const context = useContext(BrowserNfcContext)
  if (!context) {
    throw new Error('useBrowserNfc must be used inside BrowserNfcProvider')
  }
  return context
}
