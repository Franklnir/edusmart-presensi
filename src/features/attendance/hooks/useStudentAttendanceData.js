import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { fetchAbsensiSettings } from '../../../utils/absensiSettings'
import { getDayName, getToday, toMinutes } from '../utils/attendanceDate'

const HARI_ORDER = [
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
  'Minggu'
]

export function useStudentAttendanceData({
  currentMinutes,
  mapel,
  periodFilter,
  profile,
  pushLoadErrorToast,
  setIsSubmitting,
  setMapel,
  tab,
  tgl,
  userId,
}) {
  const [status, setStatus] = useState(null)
  const [ringkas, setRingkas] = useState({ H: 0, I: 0, S: 0, A: 0 })
  const [jadwalHariIni, setJadwalHariIni] = useState([])
  const [jadwalMingguIni, setJadwalMingguIni] = useState({})
  const [currentJadwal, setCurrentJadwal] = useState(null)
  const [currentJadwalIndex, setCurrentJadwalIndex] = useState(-1)
  const [isAbsenOpen, setIsAbsenOpen] = useState(false)
  const [statistikKehadiran, setStatistikKehadiran] = useState({
    Hadir: 0,
    Izin: 0,
    Sakit: 0,
    Alpha: 0
  })
  const [jamKosongList, setJamKosongList] = useState([])
  const [isLoadingJadwalMinggu, setIsLoadingJadwalMinggu] = useState(false)

  const jadwalRef = useRef([])
  const statusRef = useRef(status)
  const refreshFnsRef = useRef({
    loadRingkasDanStatus: null,
    loadJadwalHariIni: null,
    loadStatistikKehadiran: null
  })

  const loadStatistikKehadiran = useCallback(async () => {
    if (!userId) return
    try {
      const today = getToday()

      let query = supabase
        .from('absensi')
        .select('status')
        .eq('uid', userId)
        .eq('tanggal', today)

      if (periodFilter.tahunAjaran) query = query.eq('tahun_ajaran', periodFilter.tahunAjaran)
      if (periodFilter.semester) query = query.eq('semester', periodFilter.semester)

      const { data, error } = await query

      if (error) throw error

      const statistik = { Hadir: 0, Izin: 0, Sakit: 0, Alpha: 0 }
      ; (data || []).forEach((item) => {
        if (item.status === 'Hadir') statistik.Hadir++
        else if (item.status === 'Izin') statistik.Izin++
        else if (item.status === 'Sakit') statistik.Sakit++
        else if (item.status === 'Alpha') statistik.Alpha++
      })
      setStatistikKehadiran(statistik)
    } catch (error) {
      console.error('Error loading statistik kehadiran:', error)
    }
  }, [periodFilter.semester, periodFilter.tahunAjaran, userId])

  const loadJadwalHariIni = useCallback(async () => {
    if (!profile?.kelas || !userId) return

    try {
      const hari = getDayName(getToday())
      const today = getToday()

      let jadwalQuery = supabase
        .from('jadwal')
        .select('*')
        .eq('kelas_id', profile.kelas)
        .eq('hari', hari)
        .order('jam_mulai')

      if (periodFilter.tahunAjaran) jadwalQuery = jadwalQuery.eq('tahun_ajaran', periodFilter.tahunAjaran)
      if (periodFilter.semester) jadwalQuery = jadwalQuery.eq('semester', periodFilter.semester)

      let jamKosongQuery = supabase
        .from('jam_kosong')
        .select('*')
        .eq('kelas', profile.kelas)
        .eq('tanggal', today)
        .order('jam_mulai')

      if (periodFilter.tahunAjaran) jamKosongQuery = jamKosongQuery.eq('tahun_ajaran', periodFilter.tahunAjaran)
      if (periodFilter.semester) jamKosongQuery = jamKosongQuery.eq('semester', periodFilter.semester)

      const [jadwalRes, settingsRes, jamKosongRes] = await Promise.all([
        jadwalQuery,
        fetchAbsensiSettings({
          kelas: profile.kelas,
          tanggal: today,
          periodFilter
        }),
        jamKosongQuery
      ])

      if (jadwalRes.error) throw jadwalRes.error

      const jadwalList = jadwalRes.data || []
      const settingsList = settingsRes.data || []
      if (settingsRes.error) {
        console.warn('Error loading absensi settings:', settingsRes.error)
      }
      if (jamKosongRes.error) {
        console.warn('Error loading jam kosong:', jamKosongRes.error)
      }

      const jamKosongRows = jamKosongRes.data || []
      setJamKosongList(jamKosongRows)

      const mapels = Array.from(new Set(
        jadwalList.map((item) => item?.mapel).filter(Boolean)
      ))
      let absensiRows = []
      if (mapels.length > 0) {
        let absensiQuery = supabase
          .from('absensi')
          .select('mapel, status, waktu')
          .eq('kelas', profile.kelas)
          .eq('tanggal', today)
          .eq('uid', userId)
          .in('mapel', mapels)
          .order('waktu', { ascending: false })

        if (periodFilter.tahunAjaran) absensiQuery = absensiQuery.eq('tahun_ajaran', periodFilter.tahunAjaran)
        if (periodFilter.semester) absensiQuery = absensiQuery.eq('semester', periodFilter.semester)

        const { data, error } = await absensiQuery
        if (error) {
          console.warn('Error load status absensi jadwal:', error)
        } else {
          absensiRows = data || []
        }
      }

      const latestAbsensiByMapel = new Map()
      ;(absensiRows || []).forEach((row) => {
        if (row?.mapel && !latestAbsensiByMapel.has(row.mapel)) {
          latestAbsensiByMapel.set(row.mapel, row)
        }
      })

      const jamKosongByMapel = new Map()
      ;(jamKosongRows || []).forEach((row) => {
        if (row?.mapel && !jamKosongByMapel.has(row.mapel)) {
          jamKosongByMapel.set(row.mapel, row)
        }
      })

      const jadwalWithStatus = (jadwalList || []).map((jadwalItem) => {
        const settingsForMapel = (settingsList || []).find(
          (s) => s.mapel === jadwalItem.mapel
        )
        const mode = settingsForMapel?.mode || 'manual'
        const allowSelfAbsen = Boolean(settingsForMapel?.allow_self_absen)
        const absensi = latestAbsensiByMapel.get(jadwalItem.mapel) || null
        const startMinutes = toMinutes(jadwalItem.jam_mulai)
        const endMinutes = toMinutes(jadwalItem.jam_selesai)
        const isOpen = currentMinutes >= startMinutes && currentMinutes <= endMinutes

        return {
          ...jadwalItem,
          mode,
          allow_self_absen: allowSelfAbsen,
          status: absensi?.status || null,
          isOpen,
          jamKosong: jamKosongByMapel.get(jadwalItem.mapel) || null
        }
      })

      const jadwalSorted = jadwalWithStatus.sort(
        (a, b) => toMinutes(a.jam_mulai) - toMinutes(b.jam_mulai)
      )

      setJadwalHariIni(jadwalSorted)

      const currentIndex = jadwalSorted.findIndex((jadwal) => {
        const startMinutes = toMinutes(jadwal.jam_mulai)
        const endMinutes = toMinutes(jadwal.jam_selesai)
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes
      })

      if (currentIndex !== -1) {
        setCurrentJadwalIndex(currentIndex)
        const currentJadwalItem = jadwalSorted[currentIndex]
        setCurrentJadwal(currentJadwalItem)
        if (tab === 'manual') setMapel(currentJadwalItem.mapel)
      } else {
        setCurrentJadwalIndex(-1)
        setCurrentJadwal(null)
      }
    } catch (error) {
      console.error('Error loading jadwal:', error)
      pushLoadErrorToast('jadwal-hari-ini', 'Gagal memuat jadwal hari ini')
    }
  }, [
    currentMinutes,
    periodFilter,
    periodFilter.semester,
    periodFilter.tahunAjaran,
    profile?.kelas,
    pushLoadErrorToast,
    setMapel,
    tab,
    userId,
  ])

  const loadJadwalMingguIni = useCallback(async () => {
    if (!profile?.kelas) return

    setIsLoadingJadwalMinggu(true)
    try {
      let query = supabase
        .from('jadwal')
        .select('*')
        .eq('kelas_id', profile.kelas)
        .order('hari')
        .order('jam_mulai')

      if (periodFilter.tahunAjaran) query = query.eq('tahun_ajaran', periodFilter.tahunAjaran)
      if (periodFilter.semester) query = query.eq('semester', periodFilter.semester)

      const { data: jadwalList, error } = await query

      if (error) throw error

      const { data: settingsList, error: settingsError } = await fetchAbsensiSettings({
        kelas: profile.kelas,
        tanggal: getToday(),
        periodFilter
      })

      if (settingsError) {
        console.warn('Error loading absensi settings:', settingsError)
      }

      const jadwalByHari = {}
      HARI_ORDER.forEach((hari) => {
        jadwalByHari[hari] = []
      })

      ; (jadwalList || []).forEach((jadwal) => {
        if (jadwalByHari[jadwal.hari]) {
          const settingsForMapel = (settingsList || []).find((item) => item.mapel === jadwal.mapel)
          jadwalByHari[jadwal.hari].push({
            ...jadwal,
            mode: settingsForMapel?.mode || 'manual',
            allow_self_absen: Boolean(settingsForMapel?.allow_self_absen)
          })
        }
      })

      Object.keys(jadwalByHari).forEach((hari) => {
        jadwalByHari[hari].sort(
          (a, b) => toMinutes(a.jam_mulai) - toMinutes(b.jam_mulai)
        )
      })

      setJadwalMingguIni(jadwalByHari)
    } catch (error) {
      console.error('Error loading jadwal minggu:', error)
      pushLoadErrorToast('jadwal-minggu', 'Gagal memuat jadwal minggu ini')
    } finally {
      setIsLoadingJadwalMinggu(false)
    }
  }, [periodFilter, periodFilter.semester, periodFilter.tahunAjaran, profile?.kelas, pushLoadErrorToast])

  const loadRingkasDanStatus = useCallback(async () => {
    if (!profile?.kelas || !userId || !mapel || !tgl) return
    try {
      let query = supabase
        .from('absensi')
        .select('uid, status')
        .eq('kelas', profile.kelas)
        .eq('tanggal', tgl)
        .eq('mapel', mapel)

      if (periodFilter.tahunAjaran) query = query.eq('tahun_ajaran', periodFilter.tahunAjaran)
      if (periodFilter.semester) query = query.eq('semester', periodFilter.semester)

      const { data, error } = await query

      if (error) throw error

      const agg = { H: 0, I: 0, S: 0, A: 0 }
      let myStatus = null

      ; (data || []).forEach((row) => {
        if (row.status === 'Hadir') agg.H++
        else if (row.status === 'Izin') agg.I++
        else if (row.status === 'Sakit') agg.S++
        else if (row.status === 'Alpha') agg.A++

        if (row.uid === userId) myStatus = row.status
      })

      setRingkas(agg)
      setStatus(myStatus)
      statusRef.current = myStatus
    } catch (err) {
      console.error('Error loadRingkasDanStatus:', err)
      pushLoadErrorToast('ringkas-absensi', 'Gagal memuat data absensi')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    mapel,
    periodFilter.semester,
    periodFilter.tahunAjaran,
    profile?.kelas,
    pushLoadErrorToast,
    setIsSubmitting,
    tgl,
    userId,
  ])

  useEffect(() => {
    jadwalRef.current = jadwalHariIni
  }, [jadwalHariIni])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    refreshFnsRef.current = {
      loadRingkasDanStatus,
      loadJadwalHariIni,
      loadStatistikKehadiran
    }
  }, [loadRingkasDanStatus, loadJadwalHariIni, loadStatistikKehadiran])

  useEffect(() => {
    loadJadwalHariIni()
    loadStatistikKehadiran()
  }, [loadJadwalHariIni, loadStatistikKehadiran])

  useEffect(() => {
    if (tab === 'jadwal') {
      loadJadwalMingguIni()
    }
  }, [tab, loadJadwalMingguIni])

  useEffect(() => {
    if (!mapel) {
      setRingkas({ H: 0, I: 0, S: 0, A: 0 })
      setStatus(null)
      setCurrentJadwal(null)
      return
    }
    loadRingkasDanStatus()
    const jadwal = jadwalHariIni.find((j) => j.mapel === mapel)
    setCurrentJadwal(jadwal || null)
  }, [mapel, loadRingkasDanStatus, jadwalHariIni])

  useEffect(() => {
    const checkAbsenOpen = () => {
      if (!currentJadwal || tgl !== getToday()) {
        setIsAbsenOpen(false)
        return
      }
      const startMinutes = toMinutes(currentJadwal.jam_mulai)
      const endMinutes = toMinutes(currentJadwal.jam_selesai)
      setIsAbsenOpen(currentMinutes >= startMinutes && currentMinutes <= endMinutes)
    }

    checkAbsenOpen()
    const interval = setInterval(checkAbsenOpen, 30000)
    return () => clearInterval(interval)
  }, [currentJadwal, currentMinutes, tgl])

  const selectedMapelJadwal = useMemo(() => {
    if (!mapel) return null
    return (jadwalHariIni || []).find((j) => j.mapel === mapel) || null
  }, [mapel, jadwalHariIni])

  const izinAvailability = useMemo(() => {
    if (!mapel) {
      return { allowed: false, reason: 'Pilih mapel terlebih dahulu' }
    }
    if (status) {
      return { allowed: false, reason: 'Anda sudah memiliki status absensi' }
    }
    if (tgl !== getToday()) {
      return {
        allowed: false,
        reason: 'Izin hanya bisa diajukan pada tanggal hari ini'
      }
    }
    if (!selectedMapelJadwal) {
      return {
        allowed: false,
        reason: 'Mapel tidak ada di jadwal hari ini'
      }
    }

    const startMinutes = toMinutes(selectedMapelJadwal.jam_mulai)
    const endMinutes = toMinutes(selectedMapelJadwal.jam_selesai)

    if (currentMinutes < startMinutes) {
      return { allowed: false, reason: 'Sesi absensi belum dimulai' }
    }
    if (currentMinutes > endMinutes) {
      return {
        allowed: false,
        reason: 'Waktu absensi sudah habis, tidak bisa ajukan izin'
      }
    }

    return { allowed: true, reason: '' }
  }, [
    currentMinutes,
    mapel,
    selectedMapelJadwal,
    status,
    tgl,
  ])

  return {
    currentJadwal,
    currentJadwalIndex,
    hariOrder: HARI_ORDER,
    isAbsenOpen,
    isLoadingJadwalMinggu,
    izinAvailability,
    jadwalHariIni,
    jadwalMingguIni,
    jadwalRef,
    loadJadwalHariIni,
    loadJadwalMingguIni,
    loadRingkasDanStatus,
    loadStatistikKehadiran,
    refreshFnsRef,
    ringkas,
    selectedMapelJadwal,
    setCurrentJadwal,
    setCurrentJadwalIndex,
    setStatus,
    statistikKehadiran,
    status,
    statusRef,
  }
}
