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
import ProfileAvatar from '../../components/ProfileAvatar'
import {
  Save,
  History,
  ScanLine,
  Users,
  CheckCircle,
  AlertCircle,
  RefreshCcw,
  Clock,
  UserCheck,
  BarChart3
} from 'lucide-react'
import { format } from 'date-fns'
import { id as localeId } from 'date-fns/locale'

/* ========= Helpers ========= */

const HISTORY_OPTIONS = [
  { label: 'Hari ini', value: 0 },
  { label: '1 hari lalu', value: 1 },
  { label: '2 hari lalu', value: 2 },
  { label: '7 hari lalu', value: 7 }
]

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

/* ========= MAIN COMPONENT ========= */

export default function Scan() {
  const { pushToast, setLoading } = useUIStore()
  const [activeTab, setActiveTab] = useState(1)

  // --- SETTINGS ---
  const [settingsId, setSettingsId] = useState(null)
  const [manualModeEnabled, setManualModeEnabled] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [autoAlphaEnabled, setAutoAlphaEnabled] = useState(true)

  // --- STATE UMUM ---
  const [kelaslist, setKelasList] = useState([])
  const [loadingData, setLoadingData] = useState(false)

  // ref untuk stabilisasi di callback
  const scannedRef = useRef([])
  const kelaslistRef = useRef([])

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

  /* ========= LOAD SETTINGS ========= */

  useEffect(() => {
    const loadSettings = async () => {
      setSettingsLoading(true)
      try {
        const { data, error } = await supabase
          .from('settings')
          .select(`
            id,
            scan_manual_enabled,
            manual_jam_masuk_mulai,
            manual_jam_masuk_selesai,
            manual_jam_pulang_mulai,
            manual_jam_pulang_selesai
          `)
          .order('id', { ascending: true })
          .limit(1)
          .single()

        if (error && error.code !== 'PGRST116') {
          // error lain (network, dll)
          throw error
        }

        if (data) {
          // sudah ada pengaturan
          setSettingsId(data.id)
          setManualModeEnabled(data.scan_manual_enabled ?? false)

          setSessionSettings((prev) => ({
            ...prev,
            jam_masuk_mulai: data.manual_jam_masuk_mulai
              ? data.manual_jam_masuk_mulai.slice(0, 5)
              : prev.jam_masuk_mulai,
            jam_masuk_selesai: data.manual_jam_masuk_selesai
              ? data.manual_jam_masuk_selesai.slice(0, 5)
              : prev.jam_masuk_selesai,
            jam_pulang_mulai: data.manual_jam_pulang_mulai
              ? data.manual_jam_pulang_mulai.slice(0, 5)
              : prev.jam_pulang_mulai,
            jam_pulang_selesai: data.manual_jam_pulang_selesai
              ? data.manual_jam_pulang_selesai.slice(0, 5)
              : prev.jam_pulang_selesai
          }))
          return
        }

        // Tidak ada row (PGRST116) → buat default
        const { data: inserted, error: insertErr } = await supabase
          .from('settings')
          .insert({ scan_manual_enabled: false })
          .select('id, scan_manual_enabled')
          .single()

        if (insertErr) throw insertErr

        setSettingsId(inserted.id)
        setManualModeEnabled(inserted.scan_manual_enabled ?? false)
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
  }, [pushToast])

  // Auto-switch scan mode based on time
  useEffect(() => {
    if (!manualModeEnabled) return

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
  }, [manualModeEnabled, sessionSettings])

  // fungsi update settings
  const updateSettings = useCallback(
    async (payload) => {
      try {
        setSettingsLoading(true)
        if (settingsId) {
          const { error } = await supabase
            .from('settings')
            .update(payload)
            .eq('id', settingsId)

          if (error) throw error
        } else {
          const { data, error } = await supabase
            .from('settings')
            .insert(payload)
            .select('id')
            .single()

          if (error) throw error
          setSettingsId(data.id)
        }
      } catch (err) {
        console.error(err)
        pushToast(
          'error',
          'Gagal menyimpan pengaturan scan manual ke server'
        )
      } finally {
        setSettingsLoading(false)
      }
    },
    [settingsId, pushToast]
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
    if (!manualModeEnabled) {
      const ok = validateSessionSettings()
      if (!ok) return
    }

    const next = !manualModeEnabled
    setManualModeEnabled(next)
    await updateSettings({ scan_manual_enabled: next })

    if (next) {
      pushToast('success', 'Mode scan manual diaktifkan')
    } else {
      pushToast('info', 'Mode scan manual dimatikan')
    }
  }

  const handleSaveJamSettings = async () => {
    const ok = validateSessionSettings()
    if (!ok) return

    await updateSettings({
      manual_jam_masuk_mulai: sessionSettings.jam_masuk_mulai,
      manual_jam_masuk_selesai: sessionSettings.jam_masuk_selesai,
      manual_jam_pulang_mulai: sessionSettings.jam_pulang_mulai,
      manual_jam_pulang_selesai: sessionSettings.jam_pulang_selesai
    })

    pushToast('success', 'Pengaturan jam scan manual tersimpan.')
  }

  /* ========= LOAD KELAS & STATISTIK ========= */

  const loadKelasData = useCallback(
    async (dateString) => {
      setLoadingData(true)
      try {
        const { data: kelas, error: errKelas } = await supabase
          .from('kelas')
          .select('*')
          .order('grade', { ascending: true })

        if (errKelas) throw errKelas

        const { data: profiles, error: errProf } = await supabase
          .from('profiles')
          .select('id, kelas, role')
          .eq('role', 'siswa')

        if (errProf) throw errProf

        const baseDate = dateString
          ? new Date(`${dateString}T00:00:00`)
          : new Date()
        const hariIni = format(baseDate, 'EEEE', { locale: localeId })

        const { data: jadwal, error: errJadwal } = await supabase
          .from('jadwal')
          .select('kelas_id')
          .eq('hari', hariIni)

        if (errJadwal) throw errJadwal

        const stats = (kelas || []).map((k) => {
          const studentCount =
            profiles?.filter((p) => p.kelas === k.id).length || 0
          const subjectCount =
            jadwal?.filter((j) => j.kelas_id === k.id).length || 0

          return {
            ...k,
            total_siswa: studentCount,
            total_mapel: subjectCount,
            scanned_count: 0
          }
        })

        setKelasList(stats)
        kelaslistRef.current = stats
      } catch (error) {
        console.error(error)
        pushToast('error', 'Gagal memuat data kelas')
      } finally {
        setLoadingData(false)
      }
    },
    [pushToast]
  )

  useEffect(() => {
    loadKelasData(tanggal)
  }, [tanggal, loadKelasData])

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

  /* ========= LOAD SCAN HARI INI ========= */

  const loadScansFromTemp = useCallback(
    async (dateString) => {
      if (!dateString) return
      try {
        const { data: tempScans, error: errTemp } = await supabase
          .from('absensi_scan_temp')
          .select(
            'id, tanggal, siswa_id, kelas, sesi, scan_at, mapel_count, card_uid'
          )
          .eq('tanggal', dateString)
          .order('scan_at', { ascending: false })

        if (errTemp) throw errTemp

        if (!tempScans || tempScans.length === 0) {
          setScannedStudents([])
          return
        }

        const uniqueIds = Array.from(
          new Set(tempScans.map((t) => t.siswa_id))
        )

        const { data: allStudents, error: errStudents } =
          await supabase
            .from('profiles')
            .select('id, nama, kelas, photo_url, nis, rfid_uid')
            .in(
              'id',
              uniqueIds.length
                ? uniqueIds
                : ['00000000-0000-0000-0000-000000000000']
            )

        if (errStudents) throw errStudents

        const studentMap = (allStudents || []).reduce((acc, s) => {
          acc[s.id] = s
          return acc
        }, {})

        const mapped = tempScans
          .map((row) => {
            const stu = studentMap[row.siswa_id]
            if (!stu) return null

            const scanDate = row.scan_at ? new Date(row.scan_at) : null

            const kelasInfo = kelaslistRef.current.find(
              (k) => k.id === stu.kelas
            )
            const mapelCount =
              row.mapel_count ?? (kelasInfo?.total_mapel || 0)

            return {
              ...stu,
              scan_time: scanDate
                ? scanDate.toLocaleTimeString()
                : '',
              scan_date: row.scan_at,
              session: row.sesi,
              mapel_count: mapelCount
            }
          })
          .filter(Boolean)

        setScannedStudents(mapped)
      } catch (error) {
        console.error(error)
        pushToast('error', 'Gagal memuat data scan sementara')
      }
    },
    [pushToast]
  )

  useEffect(() => {
    if (!manualModeEnabled) {
      setScannedStudents([])
      return
    }
    loadScansFromTemp(tanggal)
  }, [manualModeEnabled, tanggal, loadScansFromTemp])

  /* ========= LOGIC SCANNING MANUAL ========= */

  const handleProcessScan = useCallback(
    async (code, options = {}) => {
      if (!code) return

      if (!manualModeEnabled) {
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

          const { data: jadwalAktif, error: errJadwal } = await supabase
            .from('jadwal')
            .select('*')
            .eq('kelas_id', student.kelas)
            .eq('hari', dayName)
            .lte('jam_mulai', timeStr)
            .gte('jam_selesai', timeStr)
            .maybeSingle()

          if (!jadwalAktif) {
            pushToast('warning', `Tidak ada jadwal aktif untuk ${student.nama} (${timeStr})`)
            return
          }

          const todayIso = now.toISOString().slice(0, 10)
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

          loadKelasData(todayIso)
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
          .select('id, nama, kelas, photo_url, rfid_uid, nis, status')
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

        setScannedStudents((prev) => [scanRecord, ...prev])

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

        try {
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
            console.error(
              'Gagal menyimpan ke absensi_scan_temp:',
              tempErr
            )
          }
        } catch (err) {
          console.error(
            'Exception saat upsert absensi_scan_temp:',
            err
          )
        }

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
    [sessionSettings, manualModeEnabled, pushToast, setLoading, tanggal]
  )

  useEffect(() => {
    const updateModeByTime = () => {
      const now = new Date()
      const timeStr = now.toTimeString().slice(0, 5)
      const {
        jam_masuk_mulai,
        jam_masuk_selesai,
        jam_pulang_mulai,
        jam_pulang_selesai
      } = sessionSettings

      setScanMode((prev) => {
        let current = prev
        if (
          timeStr >= jam_masuk_mulai &&
          timeStr <= jam_masuk_selesai
        ) {
          current = 'masuk'
        } else if (
          timeStr >= jam_pulang_mulai &&
          timeStr <= jam_pulang_selesai
        ) {
          current = 'pulang'
        }
        return current
      })
    }

    updateModeByTime()
    const interval = setInterval(updateModeByTime, 30000)
    return () => clearInterval(interval)
  }, [sessionSettings])

  const handleDeleteScan = async (record) => {
    if (!manualModeEnabled) {
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
      if (activeTab !== 1 || !manualModeEnabled) return

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
  }, [activeTab, manualModeEnabled, handleProcessScan])

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
          if (activeTab !== 1 || !manualModeEnabled) return
          const row = payload.new
          if (!row || row.status !== 'raw') return
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
  }, [activeTab, manualModeEnabled, handleProcessScan])

  /* ========= SIMPAN ABSENSI ========= */

  const handleSaveAttendance = async () => {
    if (!manualModeEnabled) {
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

      const { data: jadwalHariIni, error: errJadwal } = await supabase
        .from('jadwal')
        .select('*')
        .eq('hari', hariIni)

      if (errJadwal) throw errJadwal
      if (!jadwalHariIni?.length) {
        throw new Error('Tidak ada jadwal pelajaran untuk hari ini.')
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
            masuk: false,
            pulang: false
          }
        }
        if (s.session === 'masuk') scanMap[s.id].masuk = true
        if (s.session === 'pulang') scanMap[s.id].pulang = true
      })

      const absensiInserts = []

      for (const student of allStudents || []) {
        const scanData = scanMap[student.id]
        const jadwalSiswa = (jadwalHariIni || []).filter(
          (j) => j.kelas_id === student.kelas
        )

        jadwalSiswa.sort((a, b) =>
          a.jam_mulai.localeCompare(b.jam_mulai)
        )

        if (!jadwalSiswa.length) continue

        if (scanData) {
          if (scanData.masuk && scanData.pulang) {
            jadwalSiswa.forEach((mapel) => {
              const key = `${student.id}|${mapel.mapel}`
              if (!existingKey.has(key)) {
                absensiInserts.push({
                  kelas: student.kelas,
                  tanggal,
                  uid: student.id,
                  mapel: mapel.mapel,
                  status: 'Hadir',
                  nama: student.nama,
                  oleh: 'SYSTEM_RFID'
                })
              }
            })
          } else if (scanData.masuk && !scanData.pulang) {
            const first = jadwalSiswa[0]
            if (first) {
              const key = `${student.id}|${first.mapel}`
              if (!existingKey.has(key)) {
                absensiInserts.push({
                  kelas: student.kelas,
                  tanggal,
                  uid: student.id,
                  mapel: first.mapel,
                  status: 'Hadir',
                  nama: student.nama,
                  oleh: 'SYSTEM_RFID'
                })
              }
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
          `${absensiInserts.length} data absensi berhasil disimpan!`
        )
        loadKelasData(tanggal)
      } else {
        pushToast(
          'info',
          'Tidak ada data absensi baru untuk disimpan.'
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
          .order('created_at', { ascending: true })

        if (errScans) throw errScans

        const { data: allStudents, error: errStudents } =
          await supabase
            .from('profiles')
            .select(
              'id,nama,kelas,photo_url,rfid_uid'
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
    if (activeTab === 2) {
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

  /* ========= RENDER ========= */

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-6">
      <div className="w-full space-y-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Scan & Absensi RFID
              </h1>
              <p className="text-gray-600 mt-1">
                Kelola kehadiran siswa melalui scan kartu RFID dan
                pantau riwayat kehadiran
              </p>
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

              <div className="flex bg-white p-1 rounded-xl shadow-sm border border-gray-200">
                {[
                  { id: 1, label: 'Scan Kehadiran', icon: ScanLine },
                  { id: 2, label: 'Riwayat Scan', icon: History }
                ].map((tab) => (
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
          {/* --- MODE 1: SCANNING MANUAL --- */}
          {activeTab === 1 && (
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
                              onChange={(e) =>
                                setSessionSettings((prev) => ({
                                  ...prev,
                                  tanggal: e.target.value
                                }))
                              }
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
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
                                onChange={(e) =>
                                  setSessionSettings((prev) => ({
                                    ...prev,
                                    jam_masuk_mulai: e.target.value
                                  }))
                                }
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
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
                                onChange={(e) =>
                                  setSessionSettings((prev) => ({
                                    ...prev,
                                    jam_masuk_selesai: e.target.value
                                  }))
                                }
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
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
                                onChange={(e) =>
                                  setSessionSettings((prev) => ({
                                    ...prev,
                                    jam_pulang_mulai: e.target.value
                                  }))
                                }
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
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
                                onChange={(e) =>
                                  setSessionSettings((prev) => ({
                                    ...prev,
                                    jam_pulang_selesai: e.target.value
                                  }))
                                }
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
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
                                {manualModeEnabled
                                  ? 'Scan RFID aktif sesuai jam yang diatur'
                                  : 'Scan RFID dinonaktifkan'}
                              </div>
                            </div>
                            <button
                              onClick={toggleManualMode}
                              disabled={settingsLoading}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${manualModeEnabled
                                ? 'bg-blue-600'
                                : 'bg-gray-300'
                                } ${settingsLoading
                                  ? 'opacity-50 cursor-not-allowed'
                                  : ''
                                }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${manualModeEnabled
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
                              onClick={() =>
                                setAutoAlphaEnabled((prev) => !prev)
                              }
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoAlphaEnabled
                                ? 'bg-red-600'
                                : 'bg-gray-300'
                                }`}
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
                              className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-3 rounded-lg inline-flex items-center justify-center gap-2 font-medium shadow-sm transition-colors"
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

                  {/* Scanner Status */}
                  <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <h4 className="font-medium text-gray-900 mb-4">
                      Status Scanner
                    </h4>

                    {manualModeEnabled ? (
                      <div className="mb-4 p-4 text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg flex gap-3">
                        <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-semibold">
                            Mode manual aktif
                          </div>
                          <div className="mt-1">
                            Sistem otomatis menentukan{' '}
                            <b>scan MASUK</b> / <b>PULANG</b> berdasarkan
                            jam scan. Scanner RFID siap menerima input
                            dari perangkat USB.
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mb-4 p-4 text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg flex gap-3">
                        <CheckCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-semibold">
                            Mode langsung aktif
                          </div>
                          <div className="mt-1">
                            Scan RFID akan langsung mencatat kehadiran siswa ke mata pelajaran yang sedang berlangsung saat ini.
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Current Mode Indicator */}
                    <div className="grid grid-cols-2 gap-4">
                      <div
                        className={`p-4 rounded-lg border-2 text-center ${scanMode === 'masuk'
                          ? 'bg-blue-50 border-blue-500 text-blue-700'
                          : 'bg-gray-50 border-gray-300 text-gray-500'
                          }`}
                      >
                        <div className="font-semibold text-lg">
                          SCAN MASUK
                        </div>
                        <div className="text-sm mt-1">
                          {sessionSettings.jam_masuk_mulai} -{' '}
                          {sessionSettings.jam_masuk_selesai}
                        </div>
                      </div>
                      <div
                        className={`p-4 rounded-lg border-2 text-center ${scanMode === 'pulang'
                          ? 'bg-orange-50 border-orange-500 text-orange-700'
                          : 'bg-gray-50 border-gray-300 text-gray-500'
                          }`}
                      >
                        <div className="font-semibold text-lg">
                          SCAN PULANG
                        </div>
                        <div className="text-sm mt-1">
                          {sessionSettings.jam_pulang_mulai} -{' '}
                          {sessionSettings.jam_pulang_selesai}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                      <div className="font-semibold">
                        Cara Penggunaan:
                      </div>
                      <ul className="mt-1 space-y-1 list-disc list-inside">
                        <li>
                          Gunakan RFID Reader USB (mode keyboard
                          emulation)
                        </li>
                        <li>
                          Tempelkan kartu RFID → reader akan mengirimkan
                          UID
                        </li>
                        <li>
                          Scan otomatis diproses ketika menekan Enter
                        </li>
                        <li>
                          Hanya diterima dalam rentang jam scan yang
                          ditentukan
                        </li>
                      </ul>
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

              {/* Live Scan Tables */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Live Scan Feed
                    </h3>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full">
                        {scanMasuk.length} Masuk
                      </span>
                      <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full">
                        {scanPulang.length} Pulang
                      </span>
                      <span className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full">
                        {scannedStudents.length} Total
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x divide-gray-200">
                  {/* Scan Masuk Table */}
                  <div>
                    <div className="px-6 py-3 bg-blue-50 border-b border-gray-200">
                      <h4 className="font-semibold text-blue-900 flex items-center gap-2">
                        <div className="w-2 h-2 bg-blue-500 rounded-full" />
                        Scan Masuk
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
                          {scanMasuk.map((s, idx) => (
                            <tr
                              key={`${s.id}-masuk-${idx}`}
                              className={
                                idx === 0
                                  ? 'bg-green-50/50 transition-colors duration-500'
                                  : 'hover:bg-gray-50'
                              }
                            >
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <ProfileAvatar
                                    src={s.photo_url}
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
                                  onClick={() =>
                                    handleDeleteScan(s)
                                  }
                                  className="text-red-600 hover:text-red-800 text-sm font-medium"
                                >
                                  Hapus
                                </button>
                              </td>
                            </tr>
                          ))}
                          {scanMasuk.length === 0 && (
                            <tr>
                              <td
                                colSpan={4}
                                className="px-6 py-8 text-center text-gray-500"
                              >
                                Belum ada scan masuk hari ini
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Scan Pulang Table */}
                  <div>
                    <div className="px-6 py-3 bg-orange-50 border-b border-gray-200">
                      <h4 className="font-semibold text-orange-900 flex items-center gap-2">
                        <div className="w-2 h-2 bg-orange-500 rounded-full" />
                        Scan Pulang
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
                          {scanPulang.map((s, idx) => (
                            <tr
                              key={`${s.id}-pulang-${idx}`}
                              className={
                                idx === 0
                                  ? 'bg-green-50/50 transition-colors duration-500'
                                  : 'hover:bg-gray-50'
                              }
                            >
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <ProfileAvatar
                                    src={s.photo_url}
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
                                  onClick={() =>
                                    handleDeleteScan(s)
                                  }
                                  className="text-red-600 hover:text-red-800 text-sm font-medium"
                                >
                                  Hapus
                                </button>
                              </td>
                            </tr>
                          ))}
                          {scanPulang.length === 0 && (
                            <tr>
                              <td
                                colSpan={4}
                                className="px-6 py-8 text-center text-gray-500"
                              >
                                Belum ada scan pulang hari ini
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* --- MODE 2: RIWAYAT --- */}
          {activeTab === 2 && (
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
                                  src={student.photo_url}
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
