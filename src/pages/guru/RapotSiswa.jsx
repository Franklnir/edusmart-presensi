import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import useActiveAcademicPeriod from '../../hooks/useActiveAcademicPeriod'
import { getKelasDisplayName, normalizeKelasKey, toNumberOrNull, round2, makeLocalId } from './laporan/laporanUtils'

const RAPOT_TYPES = [
  { key: 'uts', label: 'UTS' },
  { key: 'uas', label: 'UAS' }
]

const SEMESTER_OPTIONS = ['Ganjil', 'Genap']

const buildKelasAliases = (kelasId, kelasMeta) => {
  const base = [
    String(kelasId || '').trim(),
    String(getKelasDisplayName(kelasMeta) || '').trim(),
    String(kelasMeta?.nama || '').trim()
  ].filter(Boolean)

  const expanded = new Set()
  base.forEach((value) => {
    const raw = String(value || '').trim()
    const dash = raw.replace(/\s+/g, '-')
    const spaced = raw.replace(/-/g, ' ')
    ;[raw, dash, spaced, raw.toLowerCase(), dash.toLowerCase(), spaced.toLowerCase(), normalizeKelasKey(raw)]
      .forEach((item) => {
        const next = String(item || '').trim()
        if (next) expanded.add(next)
      })
  })

  return Array.from(expanded)
}

const getPredikat = (nilai, kkm = 75) => {
  const score = toNumberOrNull(nilai)
  const min = toNumberOrNull(kkm) ?? 75
  if (score == null) return ''
  if (score < min) return 'D'
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  return 'C'
}

const buildScoreTone = (nilai, kkm = 75) => {
  const score = toNumberOrNull(nilai)
  const min = toNumberOrNull(kkm) ?? 75
  if (score == null) return 'bg-slate-50 text-slate-500 border-slate-200'
  if (score < min) return 'bg-red-50 text-red-700 border-red-200'
  if (score >= 90) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return 'bg-amber-50 text-amber-700 border-amber-200'
}

export default function RapotSiswa() {
  const { user } = useAuthStore()
  const { pushToast, setLoading } = useUIStore()
  const { period } = useActiveAcademicPeriod({ storageKey: 'edusmart.guru.rapot.periodFilter' })
  const [waliKelasList, setWaliKelasList] = useState([])
  const [waliHistoryOptions, setWaliHistoryOptions] = useState([])
  const [selectedContext, setSelectedContext] = useState('')
  const [students, setStudents] = useState([])
  const [mapelOptions, setMapelOptions] = useState([])
  const [rapotIndex, setRapotIndex] = useState({})
  const [rapotItemsByRapotId, setRapotItemsByRapotId] = useState({})
  const [activeModal, setActiveModal] = useState(null)
  const [rapotRows, setRapotRows] = useState([])
  const [semesterText, setSemesterText] = useState('')
  const [averageManual, setAverageManual] = useState('')
  const [useManualAverage, setUseManualAverage] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingClassData, setLoadingClassData] = useState(false)

  const activeTahunPelajaran = period?.tahunAjaran || ''
  const selectedHistory = useMemo(
    () => waliHistoryOptions.find((item) => item.key === selectedContext) || waliHistoryOptions[0] || null,
    [selectedContext, waliHistoryOptions]
  )
  const selectedKelas = selectedHistory?.kelasId || ''
  const tahunPelajaran = selectedHistory?.tahunPelajaran || activeTahunPelajaran || ''
  const selectedKelasMeta = useMemo(
    () => selectedHistory?.kelasMeta || waliKelasList.find((kelas) => String(kelas.id) === String(selectedKelas)) || null,
    [selectedHistory, selectedKelas, waliKelasList]
  )

  const applyClassData = useCallback((data) => {
    setStudents(data?.students || [])
    setMapelOptions(data?.mapels || [])
    setRapotIndex(data?.rapotIndex || {})
    setRapotItemsByRapotId(data?.itemsByRapotId || {})
  }, [])

  const makeDefaultRapotRows = useCallback(() => (
    (mapelOptions.length ? mapelOptions : ['']).map((mapel, index) => ({
      id: makeLocalId(),
      nomor: index + 1,
      mapel,
      kkm: 75,
      nilai: '',
      keterangan: ''
    }))
  ), [mapelOptions])

  const mapSavedRapotItems = useCallback((items = []) => (
    items.map((row) => ({
      id: row.id,
      nomor: row.nomor,
      mapel: row.mapel,
      kkm: row.kkm ?? 75,
      nilai: row.nilai ?? '',
      keterangan: row.keterangan || '',
      created_at: row.created_at
    }))
  ), [])

  const rapotMasterQueryKey = useMemo(
    () => ['guru', 'rapot-siswa', 'master', user?.id || '', activeTahunPelajaran || ''],
    [activeTahunPelajaran, user?.id]
  )

  const rapotClassQueryKey = useMemo(
    () => [
      'guru',
      'rapot-siswa',
      'class',
      selectedKelas || '',
      tahunPelajaran || '',
      selectedHistory?.status || 'aktif',
      getKelasDisplayName(selectedKelasMeta) || ''
    ],
    [selectedHistory?.status, selectedKelas, selectedKelasMeta, tahunPelajaran]
  )

  const loadMaster = useCallback(async () => {
    if (!user?.id) return
    try {
      const cached = queryClient.getQueryData(rapotMasterQueryKey)
      setLoading(!cached)
      if (cached) {
        setWaliKelasList(cached.kelas || [])
        setWaliHistoryOptions(cached.options || [])
        setSelectedContext((prev) => cached.options?.some((item) => item.key === prev) ? prev : (cached.options?.[0]?.key || ''))
      }

      const masterData = await queryClient.fetchQuery({
        queryKey: rapotMasterQueryKey,
        queryFn: async () => {
          const [{ data: strukturRows, error: strukturError }, { data: rapotHistoryRows, error: rapotHistoryError }] = await Promise.all([
            supabase
              .from('kelas_struktur')
              .select('kelas_id')
              .eq('wali_guru_id', user.id),
            supabase
              .from('rapot_siswa')
              .select('kelas_id, tahun_pelajaran, jenis, siswa_id, created_at, updated_at')
              .order('tahun_pelajaran', { ascending: false })
          ])
          if (strukturError) throw strukturError
          if (rapotHistoryError) throw rapotHistoryError
          const activeKelasIds = (strukturRows || []).map((row) => row.kelas_id).filter(Boolean)
          const historyKelasIds = (rapotHistoryRows || []).map((row) => row.kelas_id).filter(Boolean)
          const kelasIds = Array.from(new Set([...activeKelasIds, ...historyKelasIds].map(String).filter(Boolean)))

          if (!kelasIds.length) {
            return { kelas: [], options: [], activeKelasIds: [], historyRows: [] }
          }

          const { data: kelasRows, error: kelasError } = await supabase
            .from('kelas')
            .select('id, nama, tingkat, jurusan, angkatan')
            .in('id', kelasIds)
            .order('nama')
          if (kelasError) throw kelasError
          const nextKelas = kelasRows || []
          const kelasById = new Map(nextKelas.map((kelas) => [String(kelas.id), kelas]))
          const optionMap = new Map()
          activeKelasIds.forEach((kelasId) => {
            const normalizedId = String(kelasId || '')
            const year = activeTahunPelajaran || ''
            const key = `${normalizedId}|${year}`
            optionMap.set(key, {
              key,
              kelasId: normalizedId,
              tahunPelajaran: year,
              status: 'aktif',
              kelasMeta: kelasById.get(normalizedId) || { id: normalizedId, nama: normalizedId },
              rapotCount: 0
            })
          })
          ;(rapotHistoryRows || []).forEach((row) => {
            const normalizedId = String(row.kelas_id || '')
            const year = String(row.tahun_pelajaran || '').trim()
            if (!normalizedId || !year) return
            const key = `${normalizedId}|${year}`
            const existing = optionMap.get(key)
            optionMap.set(key, {
              key,
              kelasId: normalizedId,
              tahunPelajaran: year,
              status: existing?.status === 'aktif' ? 'aktif' : 'riwayat',
              kelasMeta: kelasById.get(normalizedId) || existing?.kelasMeta || { id: normalizedId, nama: normalizedId },
              rapotCount: (existing?.rapotCount || 0) + 1
            })
          })
          const options = Array.from(optionMap.values()).sort((a, b) => {
            if (a.status !== b.status) return a.status === 'aktif' ? -1 : 1
            const yearCompare = String(b.tahunPelajaran || '').localeCompare(String(a.tahunPelajaran || ''), 'id')
            if (yearCompare !== 0) return yearCompare
            return getKelasDisplayName(a.kelasMeta).localeCompare(getKelasDisplayName(b.kelasMeta), 'id')
          })

          return { kelas: nextKelas, options }
        },
        staleTime: 60 * 1000
      })

      const nextKelas = masterData.kelas || []
      const options = masterData.options || []

      if (!options.length) {
        setWaliKelasList([])
        setWaliHistoryOptions([])
        setSelectedContext('')
        setStudents([])
        return
      }

      setWaliKelasList(nextKelas)
      setWaliHistoryOptions(options)
      setSelectedContext((prev) => options.some((item) => item.key === prev) ? prev : (options[0]?.key || ''))
    } catch (error) {
      console.error(error)
      pushToast('error', error?.message || 'Gagal memuat kelas wali.')
    } finally {
      setLoading(false)
    }
  }, [activeTahunPelajaran, pushToast, rapotMasterQueryKey, setLoading, user?.id])

  const loadClassData = useCallback(async () => {
    if (!selectedKelas) return
    try {
      const cached = queryClient.getQueryData(rapotClassQueryKey)
      setLoadingClassData(!cached)
      if (cached) applyClassData(cached)

      const classData = await queryClient.fetchQuery({
        queryKey: rapotClassQueryKey,
        queryFn: async () => {
          const aliases = buildKelasAliases(selectedKelas, selectedKelasMeta)
          const aliasSet = new Set(aliases.map((value) => normalizeKelasKey(value)))
          const rapotQuery = supabase
            .from('rapot_siswa')
            .select('id, siswa_id, jenis, semester, tahun_pelajaran, jumlah, rata_rata, rata_rata_manual, locked_at, locked_by, created_by, updated_by, created_at, updated_at')
            .eq('kelas_id', selectedKelas)
            .eq('tahun_pelajaran', tahunPelajaran)

          let siswaQuery = supabase
            .from('profiles')
            .select('id, nama, nis, nisn, kelas')
            .eq('role', 'siswa')
            .order('nama')
          if (selectedHistory?.status === 'riwayat') {
            siswaQuery = siswaQuery.limit(1)
          } else {
            siswaQuery = aliases.length === 1 ? siswaQuery.eq('kelas', aliases[0]) : siswaQuery.in('kelas', aliases)
          }

          const batch = await supabase.batch([
            { key: 'rapot', query: rapotQuery },
            { key: 'siswa', query: siswaQuery },
            {
              key: 'jadwal',
              query: supabase
                .from('jadwal')
                .select('mapel, kelas_id')
                .in('kelas_id', aliases)
            },
            {
              key: 'mapelMaster',
              query: supabase
                .from('mata_pelajaran')
                .select('nama')
                .order('nama')
            }
          ])
          if (batch.error && !batch.data) throw batch.error
          const rapotResult = batch.data?.rapot
          const siswaResult = batch.data?.siswa
          const jadwalResult = batch.data?.jadwal
          const mapelMasterResult = batch.data?.mapelMaster
          if (rapotResult?.error) throw rapotResult.error
          if (siswaResult?.error) throw siswaResult.error
          const rapotRowsForPeriod = rapotResult?.data || []
          const rapotStudentIds = Array.from(new Set(rapotRowsForPeriod.map((row) => row.siswa_id).filter(Boolean)))
          const jadwalRows = jadwalResult?.error ? [] : (jadwalResult?.data || [])

          let nextStudents = selectedHistory?.status === 'riwayat'
            ? []
            : (siswaResult?.data || []).filter((row) => aliasSet.has(normalizeKelasKey(row.kelas)))
          if ((selectedHistory?.status === 'riwayat' || !nextStudents.length) && rapotStudentIds.length) {
            const { data: historyStudents, error: historyStudentsError } = await supabase
              .from('profiles')
              .select('id, nama, nis, nisn, kelas')
              .in('id', rapotStudentIds)
              .order('nama')
            if (historyStudentsError) throw historyStudentsError
            nextStudents = historyStudents || []
          }

          let mapels = Array.from(new Set((jadwalRows || [])
            .filter((row) => aliasSet.has(normalizeKelasKey(row.kelas_id)))
            .map((row) => String(row.mapel || '').trim())
            .filter(Boolean)))
            .sort((a, b) => a.localeCompare(b, 'id'))
          if (!mapels.length && !mapelMasterResult?.error) {
            mapels = Array.from(new Set((mapelMasterResult?.data || [])
              .map((row) => String(row.nama || '').trim())
              .filter(Boolean)))
              .sort((a, b) => a.localeCompare(b, 'id'))
          }

          const nextIndex = {}
          ;(rapotRowsForPeriod || []).forEach((row) => {
            nextIndex[`${row.siswa_id}|${row.jenis}`] = row
          })

          const rapotIds = rapotRowsForPeriod.map((row) => row.id).filter(Boolean)
          let itemsByRapotId = {}
          if (rapotIds.length) {
            const { data: itemRows, error: itemError } = await supabase
              .from('rapot_siswa_items')
              .select('id, rapot_id, nomor, mapel, kkm, nilai, predikat, keterangan, source, sent_by, sent_at, created_at, updated_at')
              .in('rapot_id', rapotIds)
              .order('nomor')
            if (itemError) {
              console.warn('Gagal memuat detail item rapot, daftar tetap ditampilkan:', itemError)
            } else {
              ;(itemRows || []).forEach((row) => {
                const key = String(row.rapot_id || '')
                if (!key) return
                if (!itemsByRapotId[key]) itemsByRapotId[key] = []
                itemsByRapotId[key].push(row)
              })
            }
          }

          return {
            students: nextStudents,
            mapels,
            rapotIndex: nextIndex,
            itemsByRapotId
          }
        },
        staleTime: 60 * 1000
      })

      applyClassData(classData)
    } catch (error) {
      console.error(error)
      pushToast('error', error?.message || 'Gagal memuat data rapot.')
    } finally {
      setLoadingClassData(false)
    }
  }, [applyClassData, pushToast, rapotClassQueryKey, selectedHistory?.status, selectedKelas, selectedKelasMeta, tahunPelajaran])

  useEffect(() => {
    loadMaster()
  }, [loadMaster])

  useEffect(() => {
    loadClassData()
  }, [loadClassData])

  const openRapot = useCallback(async (student, type) => {
    const rapot = rapotIndex[`${student.id}|${type}`] || null
    setActiveModal({ student, type, rapot })
    setSemesterText(rapot?.semester || period?.semester || 'Genap')
    setAverageManual(rapot?.rata_rata_manual ? (rapot?.rata_rata ?? '') : '')
    setUseManualAverage(Boolean(rapot?.rata_rata_manual))

    if (!rapot?.id) {
      setRapotRows(makeDefaultRapotRows())
      return
    }

    const cachedItems = rapotItemsByRapotId[rapot.id] || []
    if (cachedItems.length) {
      setRapotRows(mapSavedRapotItems(cachedItems))
      return
    }

    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('rapot_siswa_items')
        .select('*')
        .eq('rapot_id', rapot.id)
        .order('nomor')
      if (error) {
        console.warn('Gagal memuat detail rapot, memakai daftar mapel default:', error)
        setRapotRows(makeDefaultRapotRows())
        return
      }
      const savedItems = data || []
      if (!savedItems.length) {
        setRapotRows(makeDefaultRapotRows())
        return
      }
      setRapotRows(mapSavedRapotItems(savedItems))
      setRapotItemsByRapotId((prev) => ({ ...prev, [rapot.id]: savedItems }))
    } catch (error) {
      console.error(error)
      pushToast('error', error?.message || 'Gagal memuat detail rapot.')
    } finally {
      setLoading(false)
    }
  }, [
    makeDefaultRapotRows,
    mapSavedRapotItems,
    period?.semester,
    pushToast,
    rapotIndex,
    rapotItemsByRapotId,
    setLoading
  ])

  const computedTotal = useMemo(() => {
    return round2(rapotRows.reduce((sum, row) => sum + (toNumberOrNull(row.nilai) ?? 0), 0))
  }, [rapotRows])

  const computedAverage = useMemo(() => {
    const values = rapotRows.map((row) => toNumberOrNull(row.nilai)).filter((value) => value != null)
    if (!values.length) return null
    return round2(values.reduce((sum, value) => sum + value, 0) / values.length)
  }, [rapotRows])

  const displayedAverage = useManualAverage ? toNumberOrNull(averageManual) : computedAverage

  const updateRow = (rowId, field, value) => {
    setRapotRows((prev) => prev.map((row) => row.id === rowId ? { ...row, [field]: value } : row))
  }

  const saveRapot = useCallback(async () => {
    if (!activeModal?.student || !activeModal?.type || !selectedKelas || !tahunPelajaran) return
    const invalid = rapotRows.find((row) => {
      const nilai = toNumberOrNull(row.nilai)
      const kkm = toNumberOrNull(row.kkm)
      return (nilai != null && (nilai < 0 || nilai > 100)) || (kkm != null && (kkm < 0 || kkm > 100))
    })
    if (invalid) {
      pushToast('error', 'Nilai dan KKM harus berada di rentang 0 sampai 100.')
      return
    }
    if (!rapotRows.some((row) => String(row.mapel || '').trim())) {
      pushToast('error', 'Minimal satu mapel harus diisi sebelum menyimpan rapot.')
      return
    }

    try {
      setSaving(true)
      const nowIso = new Date().toISOString()
      let existingRapot = activeModal.rapot || null
      if (!existingRapot?.id) {
        const { data: foundRapot, error: foundRapotError } = await supabase
          .from('rapot_siswa')
          .select('id, siswa_id, kelas_id, jenis, semester, tahun_pelajaran, jumlah, rata_rata, rata_rata_manual, locked_at, locked_by, created_by, updated_by, created_at, updated_at')
          .eq('siswa_id', activeModal.student.id)
          .eq('kelas_id', selectedKelas)
          .eq('jenis', activeModal.type)
          .eq('tahun_pelajaran', tahunPelajaran)
          .maybeSingle()
        if (foundRapotError) throw foundRapotError
        existingRapot = foundRapot || null
      }
      const rapotId = existingRapot?.id || makeLocalId()
      const rapotPayload = {
        id: rapotId,
        siswa_id: activeModal.student.id,
        kelas_id: selectedKelas,
        jenis: activeModal.type,
        semester: String(semesterText || '').trim() || null,
        tahun_pelajaran: tahunPelajaran,
        jumlah: computedTotal,
        rata_rata: useManualAverage ? toNumberOrNull(averageManual) : computedAverage,
        rata_rata_manual: useManualAverage,
        locked_at: existingRapot?.locked_at || null,
        locked_by: existingRapot?.locked_by || null,
        created_by: existingRapot?.created_by || user?.id || null,
        updated_by: user?.id || null,
        created_at: existingRapot?.created_at || nowIso,
        updated_at: nowIso
      }
      const { error: rapotError } = await supabase
        .from('rapot_siswa')
        .upsert(rapotPayload, { onConflict: 'tenant_id,siswa_id,kelas_id,jenis,tahun_pelajaran' })
      if (rapotError) throw rapotError

      const itemPayloads = rapotRows
        .filter((row) => String(row.mapel || '').trim())
        .map((row, index) => ({
          id: row.id || makeLocalId(),
          rapot_id: rapotId,
          nomor: index + 1,
          mapel: String(row.mapel || '').trim(),
          kkm: toNumberOrNull(row.kkm),
          nilai: toNumberOrNull(row.nilai),
          predikat: getPredikat(row.nilai, row.kkm) || null,
          keterangan: String(row.keterangan || '').trim() || null,
          updated_at: nowIso,
          created_at: row.created_at || nowIso
        }))
      if (!itemPayloads.length) {
        pushToast('error', 'Minimal satu mapel harus diisi sebelum menyimpan rapot.')
        return
      }
      const { error: itemsError } = await supabase
        .from('rapot_siswa_items')
        .upsert(itemPayloads, { onConflict: 'tenant_id,rapot_id,nomor' })
      if (itemsError) throw itemsError
      pushToast('success', 'Rapot siswa berhasil disimpan.')
      const savedRapot = {
        ...existingRapot,
        ...rapotPayload,
        id: rapotId
      }
      setRapotIndex((prev) => ({
        ...prev,
        [`${activeModal.student.id}|${activeModal.type}`]: savedRapot
      }))
      setRapotItemsByRapotId((prev) => ({ ...prev, [rapotId]: itemPayloads }))
      queryClient.setQueryData(rapotClassQueryKey, (prev) => {
        if (!prev) return prev
        return {
          ...prev,
          rapotIndex: {
            ...(prev.rapotIndex || {}),
            [`${activeModal.student.id}|${activeModal.type}`]: savedRapot
          },
          itemsByRapotId: {
            ...(prev.itemsByRapotId || {}),
            [rapotId]: itemPayloads
          }
        }
      })
      setActiveModal(null)
      queryClient.invalidateQueries({ queryKey: rapotClassQueryKey })
      loadClassData().catch((refreshError) => {
        console.error(refreshError)
        pushToast('warning', 'Rapot sudah tersimpan. Daftar akan diperbarui saat halaman dimuat ulang.')
      })
    } catch (error) {
      console.error(error)
      pushToast('error', error?.message || 'Gagal menyimpan rapot siswa.')
    } finally {
      setSaving(false)
    }
  }, [
    activeModal,
    averageManual,
    computedAverage,
    computedTotal,
    loadClassData,
    pushToast,
    rapotClassQueryKey,
    rapotRows,
    selectedKelas,
    semesterText,
    tahunPelajaran,
    useManualAverage,
    user?.id
  ])

  const toggleRapotLock = useCallback(async () => {
    if (!activeModal?.student || !activeModal?.type || !selectedKelas || !tahunPelajaran) return

    try {
      setSaving(true)
      const nowIso = new Date().toISOString()
      let rapot = activeModal.rapot || null
      if (!rapot?.id) {
        const rapotId = makeLocalId()
        rapot = {
          id: rapotId,
          siswa_id: activeModal.student.id,
          kelas_id: selectedKelas,
          jenis: activeModal.type,
          semester: String(semesterText || '').trim() || null,
          tahun_pelajaran: tahunPelajaran,
          jumlah: computedTotal,
          rata_rata: displayedAverage,
          rata_rata_manual: useManualAverage,
          created_by: user?.id || null,
          updated_by: user?.id || null,
          created_at: nowIso,
          updated_at: nowIso
        }
      }

      const isLocked = Boolean(rapot.locked_at)
      const payload = {
        ...rapot,
        locked_at: isLocked ? null : nowIso,
        locked_by: isLocked ? null : (user?.id || null),
        updated_by: user?.id || null,
        updated_at: nowIso
      }

      const { error } = await supabase
        .from('rapot_siswa')
        .upsert(payload, { onConflict: 'tenant_id,siswa_id,kelas_id,jenis,tahun_pelajaran' })
      if (error) throw error

      setActiveModal((prev) => prev ? { ...prev, rapot: payload } : prev)
      setRapotIndex((prev) => ({
        ...prev,
        [`${activeModal.student.id}|${activeModal.type}`]: payload
      }))
      queryClient.invalidateQueries({ queryKey: rapotClassQueryKey })
      pushToast('success', isLocked ? 'Kunci rapot dibuka.' : 'Rapot dikunci. Guru pengampu tidak bisa mengirim nilai.')
    } catch (error) {
      console.error(error)
      pushToast('error', error?.message || 'Gagal memperbarui kunci rapot.')
    } finally {
      setSaving(false)
    }
  }, [
    activeModal,
    computedTotal,
    displayedAverage,
    pushToast,
    rapotClassQueryKey,
    selectedKelas,
    semesterText,
    tahunPelajaran,
    useManualAverage,
    user?.id
  ])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-4 sm:p-6">
      <div className="mx-auto max-w-full space-y-6">
        <section className="page-title-card">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-2xl text-white shadow-lg">
                📘
              </div>
              <div>
                <p className="page-title-kicker">Wali Kelas</p>
                <h1 className="page-title-heading">Rapot Siswa</h1>
                <p className="page-title-description">Kelola rapot UTS dan UAS siswa wali secara terstruktur.</p>
              </div>
            </div>
            <div className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:w-[380px]">
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Kelas / Riwayat Wali</label>
              <select
                value={selectedContext}
                onChange={(event) => setSelectedContext(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              >
                {waliHistoryOptions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {getKelasDisplayName(item.kelasMeta)} - {item.tahunPelajaran || 'Tanpa periode'}{item.status === 'aktif' ? ' (Aktif)' : ' (Riwayat)'}
                  </option>
                ))}
              </select>
              {!waliHistoryOptions.length && (
                <p className="mt-2 text-xs text-slate-500">Belum ada kelas wali atau riwayat rapot.</p>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase text-slate-500">Kelas</p>
              <p className="mt-1 text-lg font-black text-slate-950">{getKelasDisplayName(selectedKelasMeta) || '-'}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase text-slate-500">Tahun Pelajaran</p>
              <p className="mt-1 text-lg font-black text-slate-950">{tahunPelajaran || '-'}</p>
            </div>
            <div className={`rounded-2xl border p-4 ${
              selectedHistory?.status === 'riwayat'
                ? 'border-amber-200 bg-amber-50'
                : 'border-emerald-200 bg-emerald-50'
            }`}>
              <p className={`text-xs font-bold uppercase ${
                selectedHistory?.status === 'riwayat' ? 'text-amber-700' : 'text-emerald-700'
              }`}>Status Wali</p>
              <p className="mt-1 text-lg font-black text-slate-950">
                {selectedHistory?.status === 'riwayat' ? 'Riwayat' : 'Aktif'}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase text-slate-500">Jumlah Siswa</p>
              <p className="mt-1 text-lg font-black text-slate-950">{students.length}</p>
            </div>
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
              <p className="text-xs font-bold uppercase text-indigo-600">Format Rapot</p>
              <p className="mt-1 text-lg font-black text-slate-950">UTS & UAS</p>
            </div>
          </div>

          <div className="mb-4 flex flex-col gap-1 border-b border-slate-100 pb-4">
            <h2 className="text-xl font-black text-slate-950">Daftar Siswa Wali</h2>
            <p className="text-sm text-slate-500">Klik detail UTS atau UAS untuk membuka overlay pengisian rapot siswa.</p>
          </div>

          {loadingClassData && (
            <div className="mb-4 grid gap-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left">Nama</th>
                  <th className="px-4 py-3 text-left">NIS</th>
                  <th className="px-4 py-3 text-center">UTS</th>
                  <th className="px-4 py-3 text-center">UAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!loadingClassData && students.map((student) => (
                  <tr key={student.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{student.nama}</div>
                      <div className="text-xs text-slate-500">{student.kelas || getKelasDisplayName(selectedKelasMeta) || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{student.nis || '-'}</td>
                    {RAPOT_TYPES.map((type) => {
                      const rapot = rapotIndex[`${student.id}|${type.key}`]
                      return (
                        <td key={type.key} className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => openRapot(student, type.key)}
                            className={`rounded-xl border px-4 py-2 text-sm font-bold ${
                              rapot
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-indigo-200 bg-indigo-50 text-indigo-700'
                            }`}
                          >
                            {rapot ? `Detail ${type.label}` : `Isi ${type.label}`}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {!loadingClassData && !students.length && (
                  <tr>
                    <td colSpan="4" className="px-4 py-12 text-center text-slate-500">
                      Belum ada siswa pada kelas wali ini.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {activeModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 p-4 overflow-y-auto">
            <div className="mx-auto my-6 max-w-6xl rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50/80 p-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">Rapot {String(activeModal.type).toUpperCase()}</p>
                <h2 className="text-2xl font-black text-slate-950">{activeModal.student.nama}</h2>
                <div className="mt-2 grid gap-2 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-5">
                  <span>NIS: <b>{activeModal.student.nis || '-'}</b></span>
                  <span>NISN: <b>{activeModal.student.nisn || '-'}</b></span>
                  <span>Kelas: <b>{getKelasDisplayName(selectedKelasMeta)}</b></span>
                  <span>Tahun: <b>{tahunPelajaran || '-'}</b></span>
                  <label className="flex items-center gap-2">
                    Semester:
                    <select
                      value={semesterText}
                      onChange={(event) => setSemesterText(event.target.value)}
                      className="min-w-[120px] rounded-lg border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-900"
                    >
                      {SEMESTER_OPTIONS.map((semester) => (
                        <option key={semester} value={semester}>{semester}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
              >
                Tutup
              </button>
            </div>

            <div className="p-5 overflow-x-auto">
              <table className="w-full min-w-[840px] text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-3 py-3 text-center w-16">No</th>
                    <th className="px-3 py-3 text-left">Mapel</th>
                    <th className="px-3 py-3 text-center w-28">KKM</th>
                    <th className="px-3 py-3 text-center w-32">Nilai</th>
                    <th className="px-3 py-3 text-center w-28">Predikat</th>
                    <th className="px-3 py-3 text-left">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rapotRows.map((row, index) => (
                    <tr key={row.id}>
                      <td className="px-3 py-3 text-center font-semibold">{index + 1}</td>
                      <td className="px-3 py-3">
                        <input
                          value={row.mapel}
                          onChange={(event) => updateRow(row.id, 'mapel', event.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={row.kkm ?? ''}
                          onChange={(event) => updateRow(row.id, 'kkm', event.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={row.nilai ?? ''}
                          onChange={(event) => updateRow(row.id, 'nilai', event.target.value)}
                          className={`w-full rounded-lg border px-3 py-2 text-center font-bold ${buildScoreTone(row.nilai, row.kkm)}`}
                        />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex min-w-[42px] justify-center rounded-lg border px-2 py-1 font-bold ${buildScoreTone(row.nilai, row.kkm)}`}>
                          {getPredikat(row.nilai, row.kkm) || '-'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <input
                          value={row.keterangan}
                          onChange={(event) => updateRow(row.id, 'keterangan', event.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                          placeholder="Opsional"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-bold uppercase text-slate-500">Jumlah</div>
                    <div className="text-2xl font-black text-slate-950">{computedTotal}</div>
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase text-slate-500">Rata-rata</div>
                    <div className="text-2xl font-black text-slate-950">{displayedAverage ?? '-'}</div>
                  </div>
                </div>
                <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 sm:flex-row sm:items-center">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={useManualAverage}
                      onChange={(event) => setUseManualAverage(event.target.checked)}
                      className="rounded text-indigo-600"
                    />
                    Edit rata-rata manual
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    disabled={!useManualAverage}
                    value={averageManual}
                    onChange={(event) => setAverageManual(event.target.value)}
                    className="w-36 rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                    placeholder="0-100"
                  />
                </label>
              </div>
            </div>

            <div className="border-t border-slate-200 p-5 flex justify-end gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={toggleRapotLock}
                className={`rounded-xl px-5 py-3 font-semibold disabled:opacity-60 ${
                  activeModal.rapot?.locked_at
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                {activeModal.rapot?.locked_at ? 'Buka Kunci' : 'Kunci Rapot'}
              </button>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="rounded-xl border border-slate-200 px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={saveRapot}
                className="rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving ? 'Menyimpan...' : 'Simpan Rapot'}
              </button>
            </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
