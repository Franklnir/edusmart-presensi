// src/pages/admin/Scan.jsx
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo
} from 'react'
import { supabase } from '../../lib/supabase'
import { useUIStore } from '../../store/useUIStore'
import { useAuthStore } from '../../store/useAuthStore'
import ProfileAvatar from '../../components/ProfileAvatar'
import { filterSchedulesForSemester } from '../../utils/schedulePeriodScope'
import {
  Save,
  History,
  ScanLine,
  Users,
  CheckCircle,
  AlertCircle,
  RefreshCcw,
  Clock,
  CalendarCheck,
  UserCheck,
  BarChart3
} from 'lucide-react'
import { format } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { useLocation, useNavigate } from 'react-router-dom'
import { formatDateTime } from '../../lib/time'

/* ========= Helpers ========= */

const HISTORY_OPTIONS = [
  { label: 'Hari ini', value: 0 },
  { label: '1 hari lalu', value: 1 },
  { label: '2 hari lalu', value: 2 },
  { label: '7 hari lalu', value: 7 }
]

const SCAN_MENU_TABS = [
  { id: 'pengaturan', label: 'Pengaturan Scan', icon: ScanLine },
  { id: 'live-scan', label: 'Live Scan', icon: RefreshCcw },
  { id: 'riwayat', label: 'Riwayat', icon: History }
]

const normalizeScanMenu = (value) => {
  const menu = String(value || '').trim().toLowerCase()
  if (menu === 'live-scan' || menu === 'riwayat' || menu === 'pengaturan') {
    return menu
  }

  return 'pengaturan'
}

const canReceiveLiveScanInput = (menu) => menu === 'pengaturan' || menu === 'live-scan'

const toDateStartEnd = (daysAgo = 0) => {
  const start = new Date()
  start.setDate(start.getDate() - daysAgo)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

// tanggal lokal (bukan UTC)
const getTodayLocal = () => {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toTimeValue = (value) => String(value || '').slice(0, 5)

const semesterForDateKey = (dateKey = '') => {
  const month = Number(String(dateKey || '').slice(5, 7))
  if (!Number.isFinite(month) || month < 1 || month > 12) return ''
  return month >= 7 ? 'Ganjil' : 'Genap'
}

const SETTINGS_SCAN_COLUMNS = `
  id,
  scan_manual_enabled,
  scan_always_active,
  manual_jam_masuk_mulai,
  manual_jam_masuk_selesai,
  manual_jam_pulang_mulai,
  manual_jam_pulang_selesai,
  auto_alpha_enabled
`

const LEGACY_SETTINGS_SCAN_COLUMNS = `
  id,
  scan_manual_enabled,
  manual_jam_masuk_mulai,
  manual_jam_masuk_selesai,
  manual_jam_pulang_mulai,
  manual_jam_pulang_selesai,
  auto_alpha_enabled
`

const SCAN_SETTINGS_READONLY_MESSAGE =
  'Guru biasa hanya bisa melihat Pengaturan Scan Manual. Perubahan hanya bisa dilakukan admin sekolah, wali kelas, atau guru berjabatan.'

const isTeacherRole = (role) => ['guru', 'teacher'].includes(String(role || '').toLowerCase())

const isMissingSettingsColumnError = (error, columnName) => {
  if (!error) return false
  const raw = [
    error.code,
    error.message,
    error.details,
    error.hint
  ].filter(Boolean).join(' ').toLowerCase()

  return raw.includes(columnName.toLowerCase()) || raw.includes('schema cache')
}

const scanDateToTimeValue = (value) => {
  if (!value) return ''

  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toTimeString().slice(0, 5)
  }

  const fallback = String(value)
  const timeMatch = fallback.match(/(\d{2}:\d{2})/)
  return timeMatch?.[1] || ''
}

const mapRecentScansToStudents = (rows = [], classes = []) => {
  const classRows = Array.isArray(classes) ? classes : []

  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      if (!row?.siswa_id) return null

      const scanDate = row.scan_at ? new Date(row.scan_at) : null
      const hasScanDate = scanDate && !Number.isNaN(scanDate.getTime())
      const kelasInfo = classRows.find((k) => k.id === row.kelas)
      const mapelCount = row.mapel_count ?? (kelasInfo?.total_mapel || 0)

      return {
        id: row.siswa_id,
        nama: row.siswa_nama,
        nis: row.siswa_nis,
        kelas: row.kelas,
        photo_path: row.siswa_photo_path,
        photo_url: row.siswa_photo_url,
        rfid_uid: row.siswa_rfid_uid,
        scan_time: hasScanDate ? scanDate.toLocaleTimeString() : '',
        scan_date: row.scan_at,
        session: row.sesi,
        mapel_count: mapelCount
      }
    })
    .filter(Boolean)
}

const findRelevantMapelForSingleScan = (jadwalSiswa, scanRecord, session) => {
  if (!Array.isArray(jadwalSiswa) || jadwalSiswa.length === 0 || !scanRecord) {
    return null
  }

  const scanTime = scanDateToTimeValue(scanRecord.scan_date)
  if (!scanTime) return null

  const sorted = [...jadwalSiswa].sort((a, b) =>
    toTimeValue(a.jam_mulai).localeCompare(toTimeValue(b.jam_mulai))
  )

  const active = sorted.find((jadwal) => {
    const start = toTimeValue(jadwal.jam_mulai)
    const end = toTimeValue(jadwal.jam_selesai)
    return start && end && scanTime >= start && scanTime <= end
  })
  if (active) return active

  const first = sorted[0]
  const last = sorted[sorted.length - 1]

  if (session === 'masuk' && scanTime <= toTimeValue(first?.jam_mulai)) {
    return first
  }

  if (session === 'pulang' && scanTime >= toTimeValue(last?.jam_selesai)) {
    return last
  }

  return null
}

/* ========= MAIN COMPONENT ========= */

export default function Scan() {
  const { pushToast, setLoading } = useUIStore()
  const location = useLocation()
  const navigate = useNavigate()
  const profile = useAuthStore((state) => state.profile)
  const isTeacherProfile = isTeacherRole(profile?.role)
  const isDelegatedScanPath = typeof window !== 'undefined' &&
    window.location?.pathname?.startsWith('/guru/admin/scan')
  const activeTab = useMemo(() => {
    const params = new URLSearchParams(location.search || '')
    return normalizeScanMenu(params.get('menu'))
  }, [location.search])

  const setActiveTab = useCallback((menu) => {
    const normalized = normalizeScanMenu(menu)
    const params = new URLSearchParams(location.search || '')
    params.set('menu', normalized)
    navigate({
      pathname: location.pathname,
      search: `?${params.toString()}`
    })
  }, [location.pathname, location.search, navigate])

  // --- SETTINGS ---
  const [manualModeEnabled, setManualModeEnabled] = useState(false)
  const [scanAlwaysActive, setScanAlwaysActive] = useState(true)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [autoAlphaEnabled, setAutoAlphaEnabled] = useState(true)
  const [canManageScanSettings, setCanManageScanSettings] = useState(false)
  const scanSettingsReadonly = (isTeacherProfile || isDelegatedScanPath) && !canManageScanSettings

  // --- STATE UMUM ---
  const [kelaslist, setKelasList] = useState([])
  const [loadingData, setLoadingData] = useState(false)
  const [rfidDevices, setRfidDevices] = useState(null)
  const [rfidDevicesLoading, setRfidDevicesLoading] = useState(false)
  const [rfidDevicesError, setRfidDevicesError] = useState('')
  const [rfidStreamStatus, setRfidStreamStatus] = useState('connecting')

  // ref untuk stabilisasi di callback
  const scannedRef = useRef([])
  const kelaslistRef = useRef([])
  const rfidStreamCursorRef = useRef(0)
  const rfidStreamRefreshTimerRef = useRef(null)

  // --- STATE MODE 1 (SCANNING) ---
  const [sessionSettings, setSessionSettings] = useState(() => ({
    tanggal: getTodayLocal(),
    jam_masuk_mulai: '06:00',
    jam_masuk_selesai: '08:00',
    jam_pulang_mulai: '14:00',
    jam_pulang_selesai: '16:00'
  }))
  const { tanggal } = sessionSettings

  const [scannedStudents, setScannedStudents] = useState([])
  const [scanMode, setScanMode] = useState('masuk')
  const scanOperationalActive = scanAlwaysActive || manualModeEnabled

  // Buffer RFID reader
  const rfidBufferRef = useRef('')

  // --- STATE MODE 2 (RIWAYAT) ---
  const [historyDaysAgo, setHistoryDaysAgo] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyData, setHistoryData] = useState([])

  // Sinkronkan ref dengan state
  useEffect(() => {
    scannedRef.current = scannedStudents
  }, [scannedStudents])

  useEffect(() => {
    kelaslistRef.current = kelaslist
  }, [kelaslist])

  const applyLoadedScanSettings = useCallback((data = {}) => {
    if (!data) return

    setManualModeEnabled(data.scan_manual_enabled ?? false)
    setScanAlwaysActive(data.scan_always_active ?? true)
    setAutoAlphaEnabled(data.auto_alpha_enabled ?? true)
    if (typeof data.can_update_settings === 'boolean') {
      setCanManageScanSettings(data.can_update_settings)
    }

    setSessionSettings((prev) => ({
      ...prev,
      jam_masuk_mulai: data.manual_jam_masuk_mulai
        ? String(data.manual_jam_masuk_mulai).slice(0, 5)
        : prev.jam_masuk_mulai,
      jam_masuk_selesai: data.manual_jam_masuk_selesai
        ? String(data.manual_jam_masuk_selesai).slice(0, 5)
        : prev.jam_masuk_selesai,
      jam_pulang_mulai: data.manual_jam_pulang_mulai
        ? String(data.manual_jam_pulang_mulai).slice(0, 5)
        : prev.jam_pulang_mulai,
      jam_pulang_selesai: data.manual_jam_pulang_selesai
        ? String(data.manual_jam_pulang_selesai).slice(0, 5)
        : prev.jam_pulang_selesai
    }))
  }, [])

  /* ========= LOAD SETTINGS ========= */

  useEffect(() => {
    const loadSettings = async () => {
      setSettingsLoading(true)
      try {
        const apiSettings = await supabase.admin.scanSettings()
        if (!apiSettings.error && apiSettings.data) {
          applyLoadedScanSettings(apiSettings.data)
          return
        }

        if (apiSettings.error) {
          console.warn('Fallback load scan settings via Supabase:', apiSettings.error)
        }

        let { data, error } = await supabase
          .from('settings')
          .select(SETTINGS_SCAN_COLUMNS)
          .order('id', { ascending: true })
          .limit(1)
          .single()

        if (isMissingSettingsColumnError(error, 'scan_always_active')) {
          ; ({ data, error } = await supabase
            .from('settings')
            .select(LEGACY_SETTINGS_SCAN_COLUMNS)
            .order('id', { ascending: true })
            .limit(1)
            .single())
        }

        if (error && error.code !== 'PGRST116') {
          // error lain (network, dll)
          throw error
        }

        if (data) {
          // sudah ada pengaturan
          applyLoadedScanSettings(data)
          return
        }

        applyLoadedScanSettings({
          id: null,
          scan_manual_enabled: false,
          scan_always_active: true,
          auto_alpha_enabled: true
        })
      } catch (err) {
        console.error(err)
        pushToast(
          'error',
          'Gagal memuat konfigurasi mode scan manual'
        )
      } finally {
        setSettingsLoading(false)
      }
    }

    loadSettings()
  }, [applyLoadedScanSettings, pushToast])

  // Auto-switch scan mode based on time
  useEffect(() => {
    if (!scanOperationalActive) {
      setScanMode(null)
      return
    }

    const updateMode = () => {
      const now = new Date()
      const timeStr = now.toTimeString().slice(0, 5)
      const {
        jam_masuk_mulai,
        jam_masuk_selesai,
        jam_pulang_mulai,
        jam_pulang_selesai
      } = sessionSettings

      if (timeStr >= jam_masuk_mulai && timeStr <= jam_masuk_selesai) {
        setScanMode('masuk')
      } else if (
        timeStr >= jam_pulang_mulai &&
        timeStr <= jam_pulang_selesai
      ) {
        setScanMode('pulang')
      } else {
        setScanMode(null)
      }
    }

    updateMode()
    const timer = setInterval(updateMode, 60000)
    return () => clearInterval(timer)
  }, [scanOperationalActive, sessionSettings])

  useEffect(() => {
    if (!scanAlwaysActive) return

    const syncToday = () => {
      const today = getTodayLocal()
      setSessionSettings((prev) => (
        prev.tanggal === today ? prev : { ...prev, tanggal: today }
      ))
    }

    syncToday()
    const timer = setInterval(syncToday, 30000)
    window.addEventListener('focus', syncToday)

    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', syncToday)
    }
  }, [scanAlwaysActive])

  const notifyScanSettingsReadonly = useCallback(() => {
    pushToast('warning', SCAN_SETTINGS_READONLY_MESSAGE)
  }, [pushToast])

  const ensureCanEditScanSettings = useCallback(() => {
    if (!scanSettingsReadonly) return true
    notifyScanSettingsReadonly()
    return false
  }, [notifyScanSettingsReadonly, scanSettingsReadonly])

  const guardReadonlyScanSettingsInput = useCallback((event) => {
    if (!scanSettingsReadonly) return
    event.preventDefault()
    event.stopPropagation()
    notifyScanSettingsReadonly()
  }, [notifyScanSettingsReadonly, scanSettingsReadonly])

  const updateSessionSettingValue = useCallback((field, value) => {
    if (!ensureCanEditScanSettings()) return
    setSessionSettings((prev) => ({
      ...prev,
      [field]: value
    }))
  }, [ensureCanEditScanSettings])

  // fungsi update settings
  const updateSettings = useCallback(
    async (payload) => {
      if (!ensureCanEditScanSettings()) {
        return false
      }

      try {
        setSettingsLoading(true)

        const apiSave = await supabase.admin.updateScanSettings(payload)
        if (apiSave.error) {
          throw apiSave.error
        }

        if (apiSave.data) applyLoadedScanSettings(apiSave.data)
        return true
      } catch (err) {
        console.error(err)
        pushToast(
          'error',
          err?.message
            ? `Gagal menyimpan pengaturan scan manual: ${err.message}`
            : 'Gagal menyimpan pengaturan scan manual ke server'
        )
        return false
      } finally {
        setSettingsLoading(false)
      }
    },
    [applyLoadedScanSettings, ensureCanEditScanSettings, pushToast]
  )

  /* ========= HELPER VALIDASI JAM SCAN ========= */

  const validateSessionSettings = useCallback(() => {
    const {
      jam_masuk_mulai,
      jam_masuk_selesai,
      jam_pulang_mulai,
      jam_pulang_selesai
    } = sessionSettings

    if (
      !jam_masuk_mulai ||
      !jam_masuk_selesai ||
      !jam_pulang_mulai ||
      !jam_pulang_selesai
    ) {
      pushToast(
        'error',
        'Jam scan masuk dan pulang harus diisi semua.'
      )
      return false
    }

    if (!(jam_masuk_mulai < jam_masuk_selesai)) {
      pushToast(
        'error',
        'Jam mulai scan MASUK harus lebih kecil dari jam selesai.'
      )
      return false
    }

    if (!(jam_pulang_mulai < jam_pulang_selesai)) {
      pushToast(
        'error',
        'Jam mulai scan PULANG harus lebih kecil dari jam selesai.'
      )
      return false
    }

    if (!(jam_masuk_selesai <= jam_pulang_mulai)) {
      pushToast(
        'error',
        'Rentang scan MASUK dan PULANG tidak boleh bertumpukan.'
      )
      return false
    }

    return true
  }, [sessionSettings, pushToast])

  const toggleManualMode = async () => {
    if (!ensureCanEditScanSettings()) return

    if (scanAlwaysActive) {
      pushToast('info', 'Mode manual dikelola otomatis karena scan harian realtime aktif.')
      return
    }

    if (!manualModeEnabled) {
      const ok = validateSessionSettings()
      if (!ok) return
    }

    const next = !manualModeEnabled
    const previous = manualModeEnabled
    setManualModeEnabled(next)
    const saved = await updateSettings({ scan_manual_enabled: next })
    if (!saved) {
      setManualModeEnabled(previous)
      return
    }

    if (next) {
      pushToast('success', 'Mode scan manual diaktifkan')
    } else {
      pushToast('info', 'Mode scan manual dimatikan')
    }
  }

  const toggleScanAlwaysActive = async () => {
    if (!ensureCanEditScanSettings()) return

    const next = !scanAlwaysActive

    if (next) {
      const ok = validateSessionSettings()
      if (!ok) return

      const today = getTodayLocal()
      const previousAlwaysActive = scanAlwaysActive
      const previousManualMode = manualModeEnabled
      setSessionSettings((prev) => ({ ...prev, tanggal: today }))
      setScanAlwaysActive(true)
      setManualModeEnabled(true)
      const saved = await updateSettings({
        scan_always_active: true,
        scan_manual_enabled: true
      })
      if (!saved) {
        setScanAlwaysActive(previousAlwaysActive)
        setManualModeEnabled(previousManualMode)
        return
      }
      pushToast('success', 'Scan harian realtime diaktifkan. Tanggal operasional otomatis mengikuti hari ini.')
    } else {
      const previousAlwaysActive = scanAlwaysActive
      const previousManualMode = manualModeEnabled
      setScanAlwaysActive(false)
      setManualModeEnabled(false)
      const saved = await updateSettings({
        scan_always_active: false,
        scan_manual_enabled: false
      })
      if (!saved) {
        setScanAlwaysActive(previousAlwaysActive)
        setManualModeEnabled(previousManualMode)
        return
      }
      pushToast('info', 'Scan harian realtime dimatikan. Mode manual bisa diatur sendiri.')
    }
  }

  const handleSaveJamSettings = async () => {
    if (!ensureCanEditScanSettings()) return

    const ok = validateSessionSettings()
    if (!ok) return

    const saved = await updateSettings({
      manual_jam_masuk_mulai: sessionSettings.jam_masuk_mulai,
      manual_jam_masuk_selesai: sessionSettings.jam_masuk_selesai,
      manual_jam_pulang_mulai: sessionSettings.jam_pulang_mulai,
      manual_jam_pulang_selesai: sessionSettings.jam_pulang_selesai
    })
    if (!saved) return

    pushToast('success', 'Pengaturan jam scan manual tersimpan.')
  }

  const toggleAutoAlpha = async () => {
    if (!ensureCanEditScanSettings()) return

    const next = !autoAlphaEnabled
    setAutoAlphaEnabled(next)
    const saved = await updateSettings({ auto_alpha_enabled: next })
    if (!saved) {
      setAutoAlphaEnabled(!next)
    }
  }

  const loadRfidDevices = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setRfidDevicesLoading(true)
      setRfidDevicesError('')
      try {
        const { data, error } = await supabase.admin.rfidDevices()
        if (error) throw error
        setRfidDevices(data || { summary: { total: 0, online: 0, offline: 0 }, devices: [] })
      } catch (error) {
        console.error('Error loading RFID devices:', error)
        setRfidDevicesError(error?.message || 'Gagal memuat status alat RFID')
        if (!silent) {
          pushToast('error', error?.message || 'Gagal memuat status alat RFID')
        }
      } finally {
        if (!silent) setRfidDevicesLoading(false)
      }
    },
    [pushToast]
  )

  useEffect(() => {
    loadRfidDevices()
    const timer = window.setInterval(() => {
      loadRfidDevices({ silent: true })
    }, 30000)

    return () => window.clearInterval(timer)
  }, [loadRfidDevices])

  /* ========= LOAD KELAS, STATISTIK & SCAN ========= */

  const loadScanSummary = useCallback(
    async (dateString, { silent = false, includeScans } = {}) => {
      if (!dateString) return null

      const shouldIncludeScans = includeScans ?? scanOperationalActive
      if (!silent) setLoadingData(true)
      try {
        const { data, error } = await supabase.admin.scanSessionSummary({ date: dateString })
        if (error) throw error

        const stats = data?.classes || []
        setKelasList(stats)
        kelaslistRef.current = stats

        if (shouldIncludeScans) {
          setScannedStudents(mapRecentScansToStudents(data?.recent_scans || [], stats))
        } else {
          setScannedStudents([])
        }

        return data
      } catch (error) {
        console.error(error)
        pushToast('error', 'Gagal memuat ringkasan scan RFID')

        return null
      } finally {
        if (!silent) setLoadingData(false)
      }
    },
    [pushToast, scanOperationalActive]
  )

  useEffect(() => {
    loadScanSummary(tanggal, { includeScans: scanOperationalActive })
  }, [scanOperationalActive, tanggal, loadScanSummary])

  useEffect(() => {
    setKelasList((prev) =>
      prev.map((k) => {
        const uniqueIds = new Set(
          scannedStudents
            .filter((s) => s.kelas === k.id)
            .map((s) => s.id)
        )
        return { ...k, scanned_count: uniqueIds.size }
      })
    )
  }, [scannedStudents])

  const refreshScanSummarySoon = useCallback(() => {
    if (rfidStreamRefreshTimerRef.current) {
      window.clearTimeout(rfidStreamRefreshTimerRef.current)
    }

    rfidStreamRefreshTimerRef.current = window.setTimeout(() => {
      rfidStreamRefreshTimerRef.current = null
      loadScanSummary(tanggal, { silent: true, includeScans: scanOperationalActive })
    }, 150)
  }, [loadScanSummary, scanOperationalActive, tanggal])

  const handleRfidStreamEvent = useCallback((eventData = {}) => {
    if (!eventData || typeof eventData !== 'object') return

    refreshScanSummarySoon()
    loadRfidDevices({ silent: true })

    if (eventData.success) {
      if (canReceiveLiveScanInput(activeTab)) {
        pushToast(
          'success',
          `RFID ${eventData.nama || eventData.card_uid || 'terbaca'}${eventData.kelas ? ` (${eventData.kelas})` : ''}`
        )
      }
      try {
        const audio = new Audio('/beep.mp3')
        audio.play().catch(() => { })
      } catch { }
      return
    }

    const message = eventData.message || eventData.reason || 'Scan RFID belum berhasil diproses'
    if (canReceiveLiveScanInput(activeTab)) {
      pushToast('warning', message)
    }
  }, [activeTab, loadRfidDevices, pushToast, refreshScanSummarySoon])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      setRfidStreamStatus('fallback')
      return undefined
    }

    let closed = false
    let source = null
    let reconnectTimer = null
    let fallbackTimer = null
    let reconnectAttempts = 0

    const startFallbackPolling = () => {
      if (closed || fallbackTimer) return
      setRfidStreamStatus('fallback')
      refreshScanSummarySoon()
      loadRfidDevices({ silent: true })
      fallbackTimer = window.setInterval(() => {
        refreshScanSummarySoon()
        loadRfidDevices({ silent: true })
      }, 2500)
    }

    const connect = async () => {
      if (closed) return
      setRfidStreamStatus((current) => current === 'connected' ? current : 'connecting')

      const streamStatus = await supabase.admin.rfidEventsStreamStatus(rfidStreamCursorRef.current)
      if (closed) return
      if (!streamStatus.data?.ready) {
        startFallbackPolling()
        return
      }

      try {
        source = new window.EventSource(
          supabase.admin.rfidEventsStreamUrl(rfidStreamCursorRef.current),
          { withCredentials: true }
        )
      } catch (error) {
        console.warn('RFID event stream fallback:', error)
        startFallbackPolling()
        return
      }

      source.addEventListener('ready', (event) => {
        try {
          const data = JSON.parse(event.data || '{}')
          if (Number(data.cursor) > 0) {
            rfidStreamCursorRef.current = Number(data.cursor)
          }
        } catch { }
        reconnectAttempts = 0
        setRfidStreamStatus('connected')
      })

      source.addEventListener('scan', (event) => {
        try {
          const data = JSON.parse(event.data || '{}')
          const cursor = Number(event.lastEventId || data.id || 0)
          if (cursor > 0) {
            rfidStreamCursorRef.current = Math.max(rfidStreamCursorRef.current, cursor)
          }
          reconnectAttempts = 0
          setRfidStreamStatus('connected')
          handleRfidStreamEvent(data)
        } catch (error) {
          console.error('RFID stream parse error:', error)
        }
      })

      source.addEventListener('ping', () => {
        setRfidStreamStatus('connected')
      })

      source.onerror = () => {
        if (closed) return
        setRfidStreamStatus('reconnecting')
        source?.close()
        reconnectAttempts += 1
        if (reconnectAttempts >= 3) {
          startFallbackPolling()
          return
        }
        reconnectTimer = window.setTimeout(connect, Math.min(1500 * reconnectAttempts, 5000))
      }
    }

    connect()

    return () => {
      closed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (fallbackTimer) window.clearInterval(fallbackTimer)
      source?.close()
      if (rfidStreamRefreshTimerRef.current) {
        window.clearTimeout(rfidStreamRefreshTimerRef.current)
        rfidStreamRefreshTimerRef.current = null
      }
    }
  }, [handleRfidStreamEvent, loadRfidDevices, refreshScanSummarySoon])

  /* ========= LOGIC SCANNING MANUAL ========= */

  const handleProcessScan = useCallback(
    async (code, options = {}) => {
      if (!code) return

      if (!scanOperationalActive) {
        // Mode Langsung: Cari siswa dan absen langsung ke mapel aktif
        setLoading(true)
        try {
          const targetUid = String(code).trim()
          let cleanedUid = targetUid
          try {
            const parsed = JSON.parse(targetUid)
            if (parsed.uid) cleanedUid = parsed.uid
          } catch { }

          const { data: student, error: errStudent } = await supabase
            .from('profiles')
            .select('id, nama, kelas, status')
            .eq('role', 'siswa')
            .eq('rfid_uid', cleanedUid)
            .single()

          if (errStudent || !student) {
            pushToast('error', 'Siswa dengan kartu ini tidak ditemukan.')
            return
          }

          if (student.status && student.status !== 'active') {
            pushToast('error', 'Akun siswa tidak aktif.')
            return
          }

          const now = new Date()
          const timeStr = now.toTimeString().slice(0, 5)
          const dayName = format(now, 'EEEE', { locale: localeId })

	          const { data: jadwalAktifRows, error: errJadwal } = await supabase
	            .from('jadwal')
	            .select('*')
	            .eq('kelas_id', student.kelas)
	            .eq('hari', dayName)
	            .lte('jam_mulai', timeStr)
	            .gte('jam_selesai', timeStr)
	            .order('jam_mulai')

	          const todayIso = now.toISOString().slice(0, 10)
	          const jadwalAktif = filterSchedulesForSemester(
	            jadwalAktifRows || [],
	            semesterForDateKey(todayIso)
	          )[0] || null

	          if (!jadwalAktif) {
	            pushToast('warning', `Tidak ada jadwal aktif untuk ${student.nama} (${timeStr})`)
	            return
	          }

	          const { error: errAbsen } = await supabase.from('absensi').upsert(
            {
              kelas: student.kelas,
              tanggal: todayIso,
              uid: student.id,
              mapel: jadwalAktif.mapel,
              status: 'Hadir',
              nama: student.nama,
              oleh: 'ADMIN_SCANNER_LANGSUNG',
              waktu: now.toISOString()
            },
            { onConflict: 'kelas,tanggal,mapel,uid' }
          )

          if (errAbsen) throw errAbsen

          // Update scan status if applicable
          if (options.fromRealtime && options.scanRowId) {
            await supabase
              .from('rfid_scans')
              .update({ status: 'processed' })
              .eq('id', options.scanRowId)
          }

          pushToast('success', `Absen langsung berhasil: ${student.nama} (${jadwalAktif.mapel})`)

          try {
            const audio = new Audio('/beep.mp3')
            audio.play().catch(() => { })
          } catch { }

          loadScanSummary(todayIso, {
            silent: true,
            includeScans: scanOperationalActive
          })
        } catch (err) {
          console.error('Error Scan Langsung:', err)
          pushToast('error', 'Gagal memproses absen langsung.')
        } finally {
          setLoading(false)
        }
        return
      }

      const { fromRealtime = false, scanRowId = null } = options

      let targetUid = code
      try {
        const parsed = JSON.parse(code)
        if (parsed.uid) targetUid = parsed.uid
      } catch {
        // bukan JSON → pakai apa adanya
      }

      const cleanedUid = String(targetUid).trim()
      console.log('SCAN UID:', cleanedUid)

      const now = new Date()
      const timeStr = now.toTimeString().slice(0, 5)

      const {
        jam_masuk_mulai,
        jam_masuk_selesai,
        jam_pulang_mulai,
        jam_pulang_selesai
      } = sessionSettings

      let currentSession = null
      if (timeStr >= jam_masuk_mulai && timeStr <= jam_masuk_selesai) {
        currentSession = 'masuk'
      } else if (
        timeStr >= jam_pulang_mulai &&
        timeStr <= jam_pulang_selesai
      ) {
        currentSession = 'pulang'
      }

      if (!currentSession) {
        pushToast(
          'error',
          `Scan di luar rentang jam scan masuk/pulang. Sekarang: ${timeStr}`
        )
        return
      }

      setScanMode(currentSession)
      setLoading(true)

      try {
        const { data: student, error } = await supabase
          .from('profiles')
          .select('id, nama, kelas, photo_url, photo_path, rfid_uid, nis, status')
          .eq('role', 'siswa')
          .eq('rfid_uid', cleanedUid)
          .single()

        if (error || !student) {
          console.error(
            'Gagal mencari siswa dari UID:',
            cleanedUid,
            error
          )
          pushToast(
            'error',
            'Siswa dengan kartu ini tidak ditemukan.'
          )
          setLoading(false)
          return
        }

        if (student.status && student.status !== 'active') {
          pushToast(
            'error',
            'Akun siswa ini tidak aktif. Scan diabaikan.'
          )
          setLoading(false)
          return
        }

        const isAlreadyScanned = scannedRef.current.find(
          (s) => s.id === student.id && s.session === currentSession
        )
        if (isAlreadyScanned) {
          pushToast(
            'info',
            `Siswa ${student.nama} sudah scan ${currentSession}.`
          )
          setLoading(false)
          return
        }

        const kelasInfo = kelaslistRef.current.find(
          (k) => k.id === student.kelas
        )
        const mapelCount = kelasInfo?.total_mapel || 0

        const scanRecord = {
          ...student,
          scan_time: now.toLocaleTimeString(),
          scan_date: now.toISOString(),
          session: currentSession,
          mapel_count: mapelCount
        }

        const { error: tempErr } = await supabase
          .from('absensi_scan_temp')
          .upsert(
            {
              tanggal,
              siswa_id: student.id,
              kelas: student.kelas,
              sesi: currentSession,
              scan_at: now.toISOString(),
              mapel_count: mapelCount,
              source: fromRealtime ? 'device' : 'web_admin',
              card_uid: cleanedUid
            },
            {
              onConflict: 'tanggal,siswa_id,sesi'
            }
          )

        if (tempErr) {
          console.error('Gagal menyimpan ke absensi_scan_temp:', tempErr)
          if (fromRealtime && scanRowId) {
            const { error: errUpdate } = await supabase
              .from('rfid_scans')
              .update({ status: 'error' })
              .eq('id', scanRowId)

            if (errUpdate) console.error(errUpdate)
          }
          pushToast(
            'error',
            'Scan belum tersimpan ke server. Data tidak ditampilkan agar tidak hilang saat refresh.'
          )
          return
        }

        if (fromRealtime && scanRowId) {
          const { error: errUpdate } = await supabase
            .from('rfid_scans')
            .update({ status: 'processed' })
            .eq('id', scanRowId)

          if (errUpdate) console.error(errUpdate)
        } else {
          const { error: errInsert } = await supabase
            .from('rfid_scans')
            .insert({
              card_uid: cleanedUid,
              status: 'processed',
              device_id: 'WEB_ADMIN_MANUAL'
            })
          if (errInsert) console.error(errInsert)
        }

        setScannedStudents((prev) => [scanRecord, ...prev])

        pushToast('success', `Scan berhasil: ${student.nama}`)

        try {
          const audio = new Audio('/beep.mp3')
          audio.play().catch(() => { })
        } catch {
          // ignore
        }
      } catch (error) {
        console.error(error)
        pushToast('error', 'Terjadi kesalahan saat memproses scan')
      } finally {
        setLoading(false)
      }
    },
    [loadScanSummary, sessionSettings, scanOperationalActive, pushToast, setLoading, tanggal]
  )

  const handleDeleteScan = async (record) => {
    if (!scanOperationalActive) {
      pushToast(
        'info',
        'Mode scan manual belum diaktifkan, penghapusan scan dinonaktifkan.'
      )
      return
    }

    const confirmed = window.confirm(
      `Hapus scan ${record.nama} untuk sesi ${record.session.toUpperCase()}?`
    )
    if (!confirmed) return

    try {
      const { error } = await supabase
        .from('absensi_scan_temp')
        .delete()
        .match({
          tanggal,
          siswa_id: record.id,
          sesi: record.session
        })

      if (error) {
        console.error(error)
        pushToast('error', 'Gagal menghapus scan di database.')
        return
      }

      setScannedStudents((prev) =>
        prev.filter(
          (s) =>
            !(
              s.id === record.id &&
              s.session === record.session
            )
        )
      )

      pushToast('success', 'Scan berhasil dihapus.')
    } catch (err) {
      console.error(err)
      pushToast('error', 'Terjadi kesalahan saat menghapus scan.')
    }
  }

  // Listener global keyboard RFID USB
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!canReceiveLiveScanInput(activeTab) || !scanOperationalActive) return

      // Jangan ganggu kalau lagi ngetik di input / textarea / select
      const tag = e.target.tagName
      const isTypingField =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        e.target.isContentEditable

      if (isTypingField) return

      if (e.key === 'Enter') {
        const raw = rfidBufferRef.current.trim()
        if (raw) {
          handleProcessScan(raw)
          rfidBufferRef.current = ''
        }
      } else if (e.key.length === 1) {
        rfidBufferRef.current += e.key
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab, scanOperationalActive, handleProcessScan])

  // Realtime dari device lain
  useEffect(() => {
    const channel = supabase
      .channel('rfid_scans_stream')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'rfid_scans'
          // kalau versi supabase-mu support, bisa tambah:
          // filter: 'status=eq.raw'
        },
        (payload) => {
          if (!canReceiveLiveScanInput(activeTab) || !scanOperationalActive) return
          const row = payload.new
          if (!row) return
          if (row.status !== 'raw') {
            refreshScanSummarySoon()
            return
          }
          handleProcessScan(row.card_uid, {
            fromRealtime: true,
            scanRowId: row.id
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeTab, scanOperationalActive, handleProcessScan, refreshScanSummarySoon])

  /* ========= SIMPAN ABSENSI ========= */

  const handleSaveAttendance = async () => {
    if (!scanOperationalActive) {
      pushToast('error', 'Mode scan manual belum diaktifkan.')
      return
    }

    if (scannedStudents.length === 0) {
      pushToast('info', 'Belum ada data scan untuk diproses.')
      return
    }

    const ok = window.confirm(
      'Anda yakin ingin menyimpan dan otomatis mengisi status kehadiran berdasarkan hasil scan?'
    )
    if (!ok) return

    setLoading(true)
    try {
      const baseDate = new Date(`${tanggal}T00:00:00`)
      const hariIni = format(baseDate, 'EEEE', { locale: localeId })

	      const { data: jadwalHariIniRaw, error: errJadwal } = await supabase
	        .from('jadwal')
	        .select('*')
	        .eq('hari', hariIni)

	      if (errJadwal) throw errJadwal
	      const jadwalHariIni = filterSchedulesForSemester(
	        jadwalHariIniRaw || [],
	        semesterForDateKey(tanggal)
	      )
	      if (!jadwalHariIni?.length) {
        pushToast(
          'info',
          'Scan masuk/pulang tetap tercatat, tetapi tidak ada jadwal pelajaran hari ini sehingga absensi mapel tidak dibuat.'
        )
        return
      }

      const { data: allStudents, error: errStudents } = await supabase
        .from('profiles')
        .select('id, nama, kelas')
        .eq('role', 'siswa')
        .eq('status', 'active')

      if (errStudents) throw errStudents

      const allStudentIds = (allStudents || []).map((s) => s.id)

      const { data: existingAbsensi, error: errAbsensi } =
        await supabase
          .from('absensi')
          .select('id, uid, mapel, tanggal')
          .eq('tanggal', tanggal)
          .in(
            'uid',
            allStudentIds.length
              ? allStudentIds
              : ['00000000-0000-0000-0000-000000000000']
          )

      if (errAbsensi) throw errAbsensi

      const existingKey = new Set(
        (existingAbsensi || []).map(
          (a) => `${a.uid}|${a.mapel}`
        )
      )

      const scanMap = {}
      scannedStudents.forEach((s) => {
        if (!scanMap[s.id]) {
          scanMap[s.id] = {
            masuk: null,
            pulang: null
          }
        }
        if (s.session === 'masuk') scanMap[s.id].masuk = s
        if (s.session === 'pulang') scanMap[s.id].pulang = s
      })

      const absensiInserts = []
      let skippedNoSchedule = 0
      let skippedSingleScanNoMapel = 0

      const addHadirIfMissing = (student, mapel) => {
        if (!mapel?.mapel) return false

        const key = `${student.id}|${mapel.mapel}`
        if (existingKey.has(key)) return false

        absensiInserts.push({
          kelas: student.kelas,
          tanggal,
          uid: student.id,
          mapel: mapel.mapel,
          status: 'Hadir',
          nama: student.nama,
          oleh: 'SYSTEM_RFID'
        })
        existingKey.add(key)
        return true
      }

      for (const student of allStudents || []) {
        const scanData = scanMap[student.id]
        const jadwalSiswa = (jadwalHariIni || []).filter(
          (j) => j.kelas_id === student.kelas
        )

        jadwalSiswa.sort((a, b) =>
          a.jam_mulai.localeCompare(b.jam_mulai)
        )

        if (!jadwalSiswa.length) {
          if (scanData) skippedNoSchedule += 1
          continue
        }

        if (scanData) {
          if (scanData.masuk && scanData.pulang) {
            jadwalSiswa.forEach((mapel) => {
              addHadirIfMissing(student, mapel)
            })
          } else {
            const session = scanData.masuk ? 'masuk' : 'pulang'
            const relevantMapel = findRelevantMapelForSingleScan(
              jadwalSiswa,
              scanData[session],
              session
            )

            if (relevantMapel) {
              addHadirIfMissing(student, relevantMapel)
            } else {
              skippedSingleScanNoMapel += 1
            }
          }
        } else if (autoAlphaEnabled) {
          jadwalSiswa.forEach((mapel) => {
            const key = `${student.id}|${mapel.mapel}`
            if (!existingKey.has(key)) {
              absensiInserts.push({
                kelas: student.kelas,
                tanggal,
                uid: student.id,
                mapel: mapel.mapel,
                status: 'Alpha',
                nama: student.nama,
                oleh: 'SYSTEM_RFID'
              })
              existingKey.add(key)
            }
          })
        }
      }

      if (absensiInserts.length > 0) {
        const { error: errInsertAbsensi } = await supabase
          .from('absensi')
          .insert(absensiInserts)

        if (errInsertAbsensi) throw errInsertAbsensi

        pushToast(
          'success',
          [
            `${absensiInserts.length} data absensi berhasil disimpan!`,
            skippedSingleScanNoMapel > 0
              ? `${skippedSingleScanNoMapel} scan satu sisi tidak punya mapel aktif/terdekat.`
              : '',
            skippedNoSchedule > 0
              ? `${skippedNoSchedule} siswa scan di kelas yang tidak punya jadwal hari ini.`
              : ''
          ].filter(Boolean).join(' ')
        )
        loadScanSummary(tanggal, {
          silent: true,
          includeScans: scanOperationalActive
        })
      } else {
        pushToast(
          'info',
          [
            'Tidak ada data absensi baru untuk disimpan.',
            skippedSingleScanNoMapel > 0
              ? `${skippedSingleScanNoMapel} scan satu sisi tidak punya mapel aktif/terdekat.`
              : '',
            skippedNoSchedule > 0
              ? `${skippedNoSchedule} siswa scan di kelas yang tidak punya jadwal hari ini.`
              : ''
          ].filter(Boolean).join(' ')
        )
      }
    } catch (error) {
      console.error(error)
      pushToast(
        'error',
        'Gagal menyimpan absensi: ' + (error.message || '')
      )
    } finally {
      setLoading(false)
    }
  }

  /* ========= LOGIC RIWAYAT ========= */

  const loadHistory = useCallback(
    async (daysAgo) => {
      setHistoryLoading(true)
      try {
        const { start, end } = toDateStartEnd(daysAgo)

        const { data: scans, error: errScans } = await supabase
          .from('rfid_scans')
          .select('*')
          .gte('created_at', start.toISOString())
          .lt('created_at', end.toISOString())
          .order('created_at', { ascending: false })

        if (errScans) throw errScans

        const { data: allStudents, error: errStudents } =
          await supabase
            .from('profiles')
            .select(
              'id,nama,kelas,photo_url,photo_path,rfid_uid'
            )
            .eq('role', 'siswa')
            .eq('status', 'active')

        if (errStudents) throw errStudents

        const allStudentsMap = (allStudents || []).reduce(
          (acc, stu) => {
            acc[stu.id] = stu
            if (stu.rfid_uid) {
              acc[`uid:${stu.rfid_uid}`] = stu
            }
            return acc
          },
          {}
        )

        const summaryMap = {}

          ; (scans || []).forEach((s) => {
            if (!s.card_uid) return
            const stuFromUid =
              allStudentsMap[`uid:${s.card_uid}`]
            if (!stuFromUid) return
            const sid = stuFromUid.id

            if (!summaryMap[sid]) {
              summaryMap[sid] = {
                student: stuFromUid,
                scanCount: 0,
                firstScan: s.created_at,
                lastScan: s.created_at
              }
            }
            summaryMap[sid].scanCount += 1
            if (s.created_at < summaryMap[sid].firstScan) {
              summaryMap[sid].firstScan = s.created_at
            }
            if (s.created_at > summaryMap[sid].lastScan) {
              summaryMap[sid].lastScan = s.created_at
            }
          })

        const result = (allStudents || []).map((stu) => {
          const sum = summaryMap[stu.id] || {
            student: stu,
            scanCount: 0,
            firstScan: null,
            lastScan: null
          }
          let statusLabel = 'Tidak scan sama sekali'
          let statusType = 'none'

          if (sum.scanCount >= 2) {
            statusLabel = 'Hadir full (scan masuk & pulang)'
            statusType = 'full'
          } else if (sum.scanCount === 1) {
            statusLabel = 'Hadir 1x scan'
            statusType = 'once'
          }

          return {
            ...sum,
            statusLabel,
            statusType
          }
        }).sort((a, b) => {
          const latestA = a.lastScan ? new Date(a.lastScan).getTime() : 0
          const latestB = b.lastScan ? new Date(b.lastScan).getTime() : 0
          if (latestA !== latestB) return latestB - latestA

          return String(a.student?.nama || '').localeCompare(String(b.student?.nama || ''), 'id')
        })

        setHistoryData(result)
      } catch (error) {
        console.error(error)
        pushToast('error', 'Gagal memuat riwayat scan')
      } finally {
        setHistoryLoading(false)
      }
    },
    [pushToast]
  )

  useEffect(() => {
    if (activeTab === 'riwayat') {
      loadHistory(historyDaysAgo)
    }
  }, [activeTab, historyDaysAgo, loadHistory])

  /* ========= DERIVED DATA ========= */

  const { scanMasuk, scanPulang, totalScannedStudents } = useMemo(() => {
    const masuk = []
    const pulang = []
    const ids = new Set()

    scannedStudents.forEach((s) => {
      ids.add(s.id)
      if (s.session === 'masuk') masuk.push(s)
      else if (s.session === 'pulang') pulang.push(s)
    })

    return {
      scanMasuk: masuk,
      scanPulang: pulang,
      totalScannedStudents: ids.size
    }
  }, [scannedStudents])

  const totalStudents = useMemo(
    () =>
      kelaslist.reduce(
        (acc, k) => acc + (k.total_siswa || 0),
        0
      ),
    [kelaslist]
  )

  const attendanceRate =
    totalStudents > 0
      ? Math.round(
        (totalScannedStudents / totalStudents) * 100
      )
      : 0

  const renderScanFeedTable = (rows, config) => (
    <div>
      <div className={`px-6 py-3 border-b border-gray-200 ${config.headerClass}`}>
        <h4 className={`font-semibold flex items-center gap-2 ${config.titleClass}`}>
          <div className={`w-2 h-2 rounded-full ${config.dotClass}`} />
          {config.title}
        </h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Siswa
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Waktu
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Kelas
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Aksi
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map((s, idx) => (
              <tr
                key={`${s.id}-${config.session}-${idx}`}
                className={idx === 0 ? 'bg-green-50/50 transition-colors duration-500' : 'hover:bg-gray-50'}
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <ProfileAvatar
                      src={s.photo_path || s.photo_url}
                      name={s.nama}
                      size={32}
                      className="border-gray-200"
                    />
                    <div>
                      <div className="font-medium text-gray-900">
                        {s.nama}
                      </div>
                      <div className="text-sm text-gray-500">
                        {s.mapel_count} mapel
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="font-mono text-gray-900">
                    {s.scan_time}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                    {s.kelas}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button
                    onClick={() => handleDeleteScan(s)}
                    className="text-red-600 hover:text-red-800 text-sm font-medium"
                  >
                    Hapus
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  Belum ada {config.emptyLabel} hari ini
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
  const rfidDeviceRows = Array.isArray(rfidDevices?.devices) ? rfidDevices.devices : []
  const rfidDeviceSummary = rfidDevices?.summary || {
    total: rfidDeviceRows.length,
    online: rfidDeviceRows.filter((device) => device?.is_online).length,
    offline: rfidDeviceRows.filter((device) => !device?.is_online).length
  }

  /* ========= RENDER ========= */

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-6">
      <div className="w-full space-y-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="page-title-card">
          <div className="page-title-layout">
            <div className="page-title-main">
              <div className="page-title-icon bg-blue-100 text-blue-600">
                <ScanLine className="h-6 w-6" />
              </div>
              <div>
                <h1 className="page-title-heading">
                  Scan & Absensi RFID
                </h1>
                <p className="page-title-description">
                  Kelola kehadiran siswa melalui scan kartu RFID dan
                  pantau riwayat kehadiran
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="bg-blue-50 px-4 py-2 rounded-xl border border-blue-200">
                <div className="text-sm text-blue-700 font-medium">
                  {attendanceRate}% Kehadiran
                </div>
                <div className="text-xs text-blue-600">
                  {totalScannedStudents} dari {totalStudents} siswa
                </div>
              </div>

              <div className="flex flex-wrap bg-white p-1 rounded-xl shadow-sm border border-gray-200">
                {SCAN_MENU_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-50'
                      }`}
                  >
                    <tab.icon size={16} />
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* --- PENGATURAN SCAN --- */}
          {activeTab === 'pengaturan' && (
            <div className="space-y-6">
              {/* Quick Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl border border-gray-200">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <Users className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-gray-900">
                        {totalStudents}
                      </div>
                      <div className="text-sm text-gray-600">
                        Total Siswa
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-gray-200">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-50 rounded-lg">
                      <UserCheck className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-gray-900">
                        {scanMasuk.length}
                      </div>
                      <div className="text-sm text-gray-600">
                        Scan Masuk
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-gray-200">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-50 rounded-lg">
                      <UserCheck className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-gray-900">
                        {scanPulang.length}
                      </div>
                      <div className="text-sm text-gray-600">
                        Scan Pulang
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-gray-200">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-50 rounded-lg">
                      <BarChart3 className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-gray-900">
                        {kelaslist.length}
                      </div>
                      <div className="text-sm text-gray-600">
                        Total Kelas
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Main Content Grid */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Settings Panel */}
                <div className="xl:col-span-2 space-y-6">
                  {/* Settings Card */}
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                      <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <Clock className="w-5 h-5 text-gray-600" />
                        Pengaturan Scan Manual
                      </h3>
                    </div>

                    <div className="p-6 space-y-6">
                      {scanSettingsReadonly && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                          Akun guru ini mendapat akses Scan Kehadiran sebagai mode lihat. Pengaturan Scan Manual hanya bisa diubah admin sekolah, wali kelas, atau guru berjabatan.
                        </div>
                      )}

                      <div className={`flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${scanAlwaysActive
                        ? 'border-blue-200 bg-blue-50'
                        : 'border-gray-200 bg-gray-50'
                        }`}>
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 rounded-lg p-2 ${scanAlwaysActive ? 'bg-blue-600 text-white' : 'bg-white text-gray-500'}`}>
                            <CalendarCheck className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">
                              Aktif Setiap Hari (Realtime)
                            </div>
                            <p className="mt-1 text-sm text-gray-600">
                              Tanggal operasional otomatis mengikuti hari ini. Scan masuk/pulang tetap aktif sesuai rentang jam tanpa perlu diset manual tiap hari.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={toggleScanAlwaysActive}
                          aria-disabled={settingsLoading || scanSettingsReadonly}
                          disabled={settingsLoading}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${scanAlwaysActive
                            ? 'bg-blue-600'
                            : 'bg-gray-300'
                            } ${settingsLoading || scanSettingsReadonly ? 'cursor-not-allowed opacity-50' : ''}`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${scanAlwaysActive
                              ? 'translate-x-6'
                              : 'translate-x-1'
                              }`}
                          />
                        </button>
                      </div>

                      {/* Date and Time Settings */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Tanggal Operasional
                            </label>
                            <input
                              type="date"
                              value={tanggal}
                              disabled={scanAlwaysActive}
                              readOnly={scanSettingsReadonly}
                              onMouseDown={guardReadonlyScanSettingsInput}
                              onKeyDown={guardReadonlyScanSettingsInput}
                              onChange={(e) => updateSessionSettingValue('tanggal', e.target.value)}
                              className={`w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:cursor-not-allowed disabled:bg-blue-50 disabled:text-blue-700 ${scanSettingsReadonly ? 'cursor-not-allowed bg-gray-50 text-gray-500' : ''}`}
                            />
                            {scanAlwaysActive && (
                              <p className="mt-2 text-xs font-medium text-blue-700">
                                Otomatis tersinkron ke tanggal hari ini secara realtime.
                              </p>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Jam Masuk Mulai
                              </label>
                              <input
                                type="time"
                                value={
                                  sessionSettings.jam_masuk_mulai
                                }
                                readOnly={scanSettingsReadonly}
                                onMouseDown={guardReadonlyScanSettingsInput}
                                onKeyDown={guardReadonlyScanSettingsInput}
                                onChange={(e) => updateSessionSettingValue('jam_masuk_mulai', e.target.value)}
                                className={`w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${scanSettingsReadonly ? 'cursor-not-allowed bg-gray-50 text-gray-500' : ''}`}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Jam Masuk Selesai
                              </label>
                              <input
                                type="time"
                                value={
                                  sessionSettings.jam_masuk_selesai
                                }
                                readOnly={scanSettingsReadonly}
                                onMouseDown={guardReadonlyScanSettingsInput}
                                onKeyDown={guardReadonlyScanSettingsInput}
                                onChange={(e) => updateSessionSettingValue('jam_masuk_selesai', e.target.value)}
                                className={`w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${scanSettingsReadonly ? 'cursor-not-allowed bg-gray-50 text-gray-500' : ''}`}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Jam Pulang Mulai
                              </label>
                              <input
                                type="time"
                                value={
                                  sessionSettings.jam_pulang_mulai
                                }
                                readOnly={scanSettingsReadonly}
                                onMouseDown={guardReadonlyScanSettingsInput}
                                onKeyDown={guardReadonlyScanSettingsInput}
                                onChange={(e) => updateSessionSettingValue('jam_pulang_mulai', e.target.value)}
                                className={`w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${scanSettingsReadonly ? 'cursor-not-allowed bg-gray-50 text-gray-500' : ''}`}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Jam Pulang Selesai
                              </label>
                              <input
                                type="time"
                                value={
                                  sessionSettings.jam_pulang_selesai
                                }
                                readOnly={scanSettingsReadonly}
                                onMouseDown={guardReadonlyScanSettingsInput}
                                onKeyDown={guardReadonlyScanSettingsInput}
                                onChange={(e) => updateSessionSettingValue('jam_pulang_selesai', e.target.value)}
                                className={`w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${scanSettingsReadonly ? 'cursor-not-allowed bg-gray-50 text-gray-500' : ''}`}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Mode Controls */}
                        <div className="space-y-6">
                          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                            <div>
                              <div className="font-medium text-gray-900">
                                Mode Scan Manual
                              </div>
                              <div className="text-sm text-gray-600">
                                {scanAlwaysActive
                                  ? 'Aktif otomatis harian sesuai jam yang diatur'
                                  : manualModeEnabled
                                    ? 'Scan RFID aktif sesuai jam yang diatur'
                                    : 'Scan RFID dinonaktifkan'}
                              </div>
                            </div>
                            <button
                              onClick={toggleManualMode}
                              aria-disabled={settingsLoading || scanAlwaysActive || scanSettingsReadonly}
                              disabled={settingsLoading || scanAlwaysActive}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${scanOperationalActive
                                ? 'bg-blue-600'
                                : 'bg-gray-300'
                                } ${settingsLoading || scanAlwaysActive || scanSettingsReadonly
                                  ? 'opacity-50 cursor-not-allowed'
                                  : ''
                                }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${scanOperationalActive
                                  ? 'translate-x-6'
                                  : 'translate-x-1'
                                  }`}
                              />
                            </button>
                          </div>

                          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                            <div>
                              <div className="font-medium text-gray-900">
                                Alpha Otomatis
                              </div>
                              <div className="text-sm text-gray-600">
                                {autoAlphaEnabled
                                  ? 'Siswa tidak scan otomatis diisi Alpha'
                                  : 'Siswa tidak scan tetap kosong'}
                              </div>
                            </div>
                            <button
                              onClick={toggleAutoAlpha}
                              aria-disabled={settingsLoading || scanSettingsReadonly}
                              disabled={settingsLoading}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoAlphaEnabled
                                ? 'bg-red-600'
                                : 'bg-gray-300'
                                } ${settingsLoading || scanSettingsReadonly ? 'cursor-not-allowed opacity-50' : ''}`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoAlphaEnabled
                                  ? 'translate-x-6'
                                  : 'translate-x-1'
                                  }`}
                              />
                            </button>
                          </div>

                          <div className="space-y-3">
                            <button
                              onClick={handleSaveJamSettings}
                              aria-disabled={scanSettingsReadonly}
                              className={`w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-3 rounded-lg inline-flex items-center justify-center gap-2 font-medium shadow-sm transition-colors ${scanSettingsReadonly ? 'cursor-not-allowed opacity-60' : ''}`}
                            >
                              <Save size={18} />
                              Simpan Pengaturan Jam
                            </button>

                            <button
                              onClick={handleSaveAttendance}
                              className="w-full bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-lg inline-flex items-center justify-center gap-2 font-medium shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={scannedStudents.length === 0}
                            >
                              <Save size={18} />
                              Simpan & Proses Absensi
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                </div>

                {/* Classes Panel */}
                <div className="space-y-6">
                  <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <h4 className="font-medium text-gray-900 mb-4">
                      Daftar Kelas
                    </h4>
                    <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                      {kelaslist.map((k) => (
                        <div
                          key={k.id}
                          className="bg-gray-50 p-4 rounded-lg border border-gray-200 hover:border-blue-300 transition-colors"
                        >
                          <div className="flex justify-between items-start mb-3">
                            <h5 className="font-semibold text-gray-900">
                              {k.nama}
                            </h5>
                            <span className="text-xs bg-white px-2 py-0.5 rounded text-gray-600 border">
                              Kelas {k.grade}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-3 text-sm">
                            <div className="text-center">
                              <div className="font-bold text-gray-900 text-lg">
                                {k.total_siswa}
                              </div>
                              <div className="text-xs text-gray-600">
                                Siswa
                              </div>
                            </div>
                            <div className="text-center">
                              <div className="font-bold text-gray-900 text-lg">
                                {k.total_mapel}
                              </div>
                              <div className="text-xs text-gray-600">
                                Mapel
                              </div>
                            </div>
                            <div className="text-center">
                              <div className="font-bold text-green-600 text-lg">
                                {k.scanned_count}
                              </div>
                              <div className="text-xs text-gray-600">
                                Scan
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-green-500 h-2 rounded-full transition-all duration-500"
                              style={{
                                width: `${k.total_siswa > 0
                                  ? Math.min(
                                    100,
                                    (k.scanned_count /
                                      k.total_siswa) *
                                    100
                                  )
                                  : 0
                                  }%`
                              }}
                            />
                          </div>
                        </div>
                      ))}
                      {kelaslist.length === 0 && !loadingData && (
                        <div className="text-center text-sm text-gray-500 py-4">
                          Tidak ada data kelas
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* --- LIVE SCAN --- */}
          {activeTab === 'live-scan' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <div className="bg-white rounded-xl border border-gray-200 p-6 xl:col-span-1">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Status Scanner
                    </h3>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                      rfidStreamStatus === 'connected'
                        ? 'border-sky-200 bg-sky-50 text-sky-700'
                        : rfidStreamStatus === 'reconnecting'
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}>
                      Stream {rfidStreamStatus === 'connected' ? 'realtime' : rfidStreamStatus === 'reconnecting' ? 'menyambung' : 'fallback'}
                    </span>
                  </div>

                  {scanOperationalActive ? (
                    <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                      <div className="flex gap-3">
                        <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                        <div>
                          <div className="font-semibold">
                            {scanAlwaysActive ? 'Scan harian realtime aktif' : 'Mode manual aktif'}
                          </div>
                          <div className="mt-1">
                            Sistem menentukan <b>scan MASUK</b> atau <b>PULANG</b> berdasarkan jam scan.
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                      <div className="flex gap-3">
                        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-gray-500" />
                        <div>
                          <div className="font-semibold">Scanner belum aktif</div>
                          <div className="mt-1">
                            Aktifkan scan harian realtime atau mode scan manual di Pengaturan Scan.
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div
                      className={`rounded-lg border-2 p-4 text-center ${scanMode === 'masuk'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-gray-50 text-gray-500'
                      }`}
                    >
                      <div className="text-lg font-semibold">SCAN MASUK</div>
                      <div className="mt-1 text-sm">
                        {sessionSettings.jam_masuk_mulai} - {sessionSettings.jam_masuk_selesai}
                      </div>
                    </div>
                    <div
                      className={`rounded-lg border-2 p-4 text-center ${scanMode === 'pulang'
                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : 'border-gray-300 bg-gray-50 text-gray-500'
                      }`}
                    >
                      <div className="text-lg font-semibold">SCAN PULANG</div>
                      <div className="mt-1 text-sm">
                        {sessionSettings.jam_pulang_mulai} - {sessionSettings.jam_pulang_selesai}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-5 xl:col-span-2">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-gray-900">
                          Status Alat RFID
                        </h3>
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                          {rfidDeviceSummary.online || 0} online
                        </span>
                        <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                          {rfidDeviceSummary.offline || 0} offline
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        Perangkat dianggap online saat heartbeat terakhir masih aktif.
                      </p>
                      {rfidDevicesError && (
                        <p className="mt-2 text-xs font-semibold text-rose-600">
                          {rfidDevicesError}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => loadRfidDevices()}
                      disabled={rfidDevicesLoading}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RefreshCcw className={`h-4 w-4 ${rfidDevicesLoading ? 'animate-spin' : ''}`} />
                      {rfidDevicesLoading ? 'Memuat...' : 'Refresh'}
                    </button>
                  </div>

                  {rfidDevicesLoading && !rfidDeviceRows.length ? (
                    <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                      Memuat status alat RFID...
                    </div>
                  ) : rfidDeviceRows.length ? (
                    <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {rfidDeviceRows.map((device) => {
                        const isOnline = Boolean(device?.is_online)
                        const boardType = String(device?.board_type || 'esp8266').toUpperCase()
                        const lastSeenLabel = device?.last_seen_at ? formatDateTime(device.last_seen_at) : 'Belum pernah aktif'
                        const ipLabel = device?.last_ip || '-'

                        return (
                          <div
                            key={device.id || device.device_id}
                            className={`rounded-xl border p-4 ${
                              isOnline ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-gray-50'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate font-semibold text-gray-900">
                                    {device.name || device.device_id || 'Alat RFID'}
                                  </p>
                                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                    {boardType}
                                  </span>
                                </div>
                                <p className="mt-1 break-all font-mono text-xs text-gray-500">
                                  {device.device_id || '-'}
                                </p>
                              </div>
                              <span
                                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                                  isOnline ? 'bg-emerald-600 text-white' : 'bg-rose-100 text-rose-700'
                                }`}
                              >
                                <span className={`h-2 w-2 rounded-full ${isOnline ? 'animate-pulse bg-white' : 'bg-rose-500'}`} />
                                {isOnline ? 'Online' : 'Offline'}
                              </span>
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <div className="rounded-lg bg-white px-3 py-2">
                                <p className="text-[11px] font-semibold uppercase text-gray-500">Terakhir aktif</p>
                                <p className="mt-1 text-sm font-semibold text-gray-900">{lastSeenLabel}</p>
                              </div>
                              <div className="rounded-lg bg-white px-3 py-2">
                                <p className="text-[11px] font-semibold uppercase text-gray-500">IP terakhir</p>
                                <p className="mt-1 break-all font-mono text-sm font-semibold text-gray-900">{ipLabel}</p>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
                      Belum ada alat RFID terdaftar untuk sekolah ini.
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Live Scan Feed
                    </h3>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-700">
                        {scanMasuk.length} Masuk
                      </span>
                      <span className="rounded-full bg-orange-100 px-3 py-1 text-orange-700">
                        {scanPulang.length} Pulang
                      </span>
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700">
                        {scannedStudents.length} Total
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 divide-y divide-gray-200 xl:grid-cols-2 xl:divide-x xl:divide-y-0">
                  {renderScanFeedTable(scanMasuk, {
                    session: 'masuk',
                    title: 'Scan Masuk',
                    emptyLabel: 'scan masuk',
                    headerClass: 'bg-blue-50',
                    titleClass: 'text-blue-900',
                    dotClass: 'bg-blue-500',
                  })}
                  {renderScanFeedTable(scanPulang, {
                    session: 'pulang',
                    title: 'Scan Pulang',
                    emptyLabel: 'scan pulang',
                    headerClass: 'bg-orange-50',
                    titleClass: 'text-orange-900',
                    dotClass: 'bg-orange-500',
                  })}
                </div>
              </div>
            </div>
          )}

          {/* --- RIWAYAT --- */}
          {activeTab === 'riwayat' && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <History className="w-5 h-5 text-gray-600" />
                      Riwayat Kehadiran
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Pantau riwayat scan siswa berdasarkan jumlah scan
                      per hari
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="inline-flex rounded-lg bg-gray-100 p-1">
                      {HISTORY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() =>
                            setHistoryDaysAgo(opt.value)
                          }
                          className={`px-3 py-1.5 rounded-md text-sm font-medium ${historyDaysAgo === opt.value
                            ? 'bg-white shadow-sm text-blue-700'
                            : 'text-gray-600 hover:text-gray-900'
                            }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => loadHistory(historyDaysAgo)}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <RefreshCcw
                        size={16}
                        className={
                          historyLoading ? 'animate-spin' : ''
                        }
                      />
                      Muat Ulang
                    </button>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Siswa
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Kelas
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Jumlah Scan
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Waktu Scan
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {historyLoading && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-6 py-8 text-center text-gray-500"
                        >
                          Memuat riwayat...
                        </td>
                      </tr>
                    )}

                    {!historyLoading &&
                      historyData.map((row) => {
                        const { student } = row
                        const first =
                          row.firstScan &&
                          new Date(row.firstScan)
                        const last =
                          row.lastScan &&
                          new Date(row.lastScan)

                        let statusColor = 'gray'
                        if (row.statusType === 'full')
                          statusColor = 'green'
                        else if (row.statusType === 'once')
                          statusColor = 'yellow'

                        return (
                          <tr
                            key={student.id}
                            className="hover:bg-gray-50"
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <ProfileAvatar
                                  src={student.photo_path || student.photo_url}
                                  name={student.nama}
                                  size={32}
                                  className="border-gray-200"
                                />
                                <div className="font-medium text-gray-900">
                                  {student.nama}
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                {student.kelas || '—'}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className="font-medium text-gray-900">
                                {row.scanCount}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor === 'green'
                                  ? 'bg-green-100 text-green-800'
                                  : statusColor === 'yellow'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-gray-100 text-gray-800'
                                  }`}
                              >
                                {row.statusLabel}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900">
                              {first ? (
                                <div>
                                  <div className="font-mono">
                                    {format(
                                      first,
                                      'HH:mm:ss'
                                    )}
                                  </div>
                                  {last &&
                                    last.getTime() !==
                                    first.getTime() && (
                                      <div className="font-mono text-gray-500 text-xs">
                                        sampai{' '}
                                        {format(
                                          last,
                                          'HH:mm:ss'
                                        )}
                                      </div>
                                    )}
                                </div>
                              ) : (
                                <span className="text-gray-400">
                                  —
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}

                    {!historyLoading &&
                      historyData.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-6 py-8 text-center text-gray-500"
                          >
                            Tidak ada data untuk hari ini
                          </td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
