import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpenCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import useActiveAcademicPeriod from '../../hooks/useActiveAcademicPeriod'
import { loadExcelJsBrowser } from '../../utils/excelBrowser'
import { getAcademicAssessmentLabels } from '../../utils/academicAssessment'
import { getKelasDisplayName, normalizeKelasKey, toNumberOrNull, round2, makeLocalId } from './laporan/laporanUtils'

const RAPOT_TYPES = [
  { key: 'uts', labelKey: 'midterm' },
  { key: 'uas', labelKey: 'final' }
]

const SOURCE_LABELS = {
  laporan_mapel: 'Dikirim guru mapel'
}

const metricLabelClass = 'text-xs font-semibold uppercase tracking-wide text-slate-500'
const metricValueClass = 'mt-1 text-lg font-semibold text-slate-950'
const tableHeaderClass = 'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500'
const modalTableHeaderClass = 'px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500'
const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100'
const secondaryButtonClass = 'rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50'

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

const toArray = (value) => {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.data)) return value.data
  if (Array.isArray(value?.rows)) return value.rows
  if (Array.isArray(value?.items)) return value.items
  return []
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
  const { period, termPeriod } = useActiveAcademicPeriod({
    storageKey: 'edusmart.guru.rapot.periodFilter',
    persistFilter: false
  })
  const [waliKelasList, setWaliKelasList] = useState([])
  const [waliHistoryOptions, setWaliHistoryOptions] = useState([])
  const [selectedContext, setSelectedContext] = useState('')
  const [students, setStudents] = useState([])
  const [mapelOptions, setMapelOptions] = useState([])
  const [rapotIndex, setRapotIndex] = useState({})
  const [rapotItemsByRapotId, setRapotItemsByRapotId] = useState({})
  const [activeModal, setActiveModal] = useState(null)
  const [rapotRows, setRapotRows] = useState([])
  const [selectedSemester, setSelectedSemester] = useState(termPeriod?.semester || 'Ganjil')
  const [saving, setSaving] = useState(false)
  const [loadingClassData, setLoadingClassData] = useState(false)
  const [exportingRapot, setExportingRapot] = useState(false)

  const activeTahunPelajaran = period?.tahunAjaran || ''
  const selectedHistory = useMemo(
    () => waliHistoryOptions.find((item) => item.key === selectedContext) || waliHistoryOptions[0] || null,
    [selectedContext, waliHistoryOptions]
  )
  const selectedKelas = selectedHistory?.kelasId || ''
  const tahunPelajaran = selectedHistory?.tahunPelajaran || activeTahunPelajaran || ''
  const assessmentLabels = useMemo(
    () => getAcademicAssessmentLabels(selectedSemester),
    [selectedSemester]
  )
  const isViewingArchiveRapot =
    tahunPelajaran !== activeTahunPelajaran ||
    selectedSemester !== termPeriod?.semester

  useEffect(() => {
    if (selectedHistory?.status === 'aktif' && termPeriod?.semester) {
      setSelectedSemester(termPeriod.semester)
    }
  }, [selectedHistory?.status, termPeriod?.semester])
  const selectedKelasMeta = useMemo(
    () => selectedHistory?.kelasMeta || waliKelasList.find((kelas) => String(kelas.id) === String(selectedKelas)) || null,
    [selectedHistory, selectedKelas, waliKelasList]
  )

  const applyClassData = useCallback((data) => {
    setStudents(toArray(data?.students ?? data?.siswa))
    setMapelOptions(toArray(data?.mapels ?? data?.mapel))
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
      keterangan: '',
      source: null,
      sent_at: null
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
      source: row.source || null,
      sent_at: row.sent_at || null,
      sent_by: row.sent_by || null,
      created_at: row.created_at
    }))
  ), [])

  const mergeSavedRapotItems = useCallback((items = []) => {
    const savedRows = mapSavedRapotItems(items)
    const savedByMapel = new Map(savedRows.map((row) => [normalizeKelasKey(row.mapel), row]))
    const merged = makeDefaultRapotRows().map((row) => {
      const saved = savedByMapel.get(normalizeKelasKey(row.mapel))
      return saved ? { ...row, ...saved, id: saved.id || row.id } : row
    })
    const mergedKeys = new Set(merged.map((row) => normalizeKelasKey(row.mapel)))
    savedRows.forEach((row) => {
      const key = normalizeKelasKey(row.mapel)
      if (key && !mergedKeys.has(key)) {
        merged.push({ ...row, nomor: Number(row.nomor || 0) || merged.length + 1 })
        mergedKeys.add(key)
      }
    })
    return merged.map((row, index) => ({ ...row, nomor: index + 1 }))
  }, [makeDefaultRapotRows, mapSavedRapotItems])

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
      selectedSemester || '',
      selectedHistory?.status || 'aktif',
      getKelasDisplayName(selectedKelasMeta) || ''
    ],
    [selectedHistory?.status, selectedKelas, selectedKelasMeta, selectedSemester, tahunPelajaran]
  )

  const loadMaster = useCallback(async () => {
    if (!user?.id) return
    try {
      const cached = queryClient.getQueryData(rapotMasterQueryKey)
      setLoading(!cached)
      if (cached) {
        const cachedKelas = toArray(cached.kelas)
        const cachedOptions = toArray(cached.options)
        setWaliKelasList(cachedKelas)
        setWaliHistoryOptions(cachedOptions)
        setSelectedContext((prev) => cachedOptions.some((item) => item.key === prev) ? prev : (cachedOptions[0]?.key || ''))
      }

      const masterData = await queryClient.fetchQuery({
        queryKey: rapotMasterQueryKey,
        queryFn: async () => {
          const [{ data: homeroomRows, error: homeroomError }, { data: rapotHistoryRows, error: rapotHistoryError }] = await Promise.all([
            supabase.reports.homeroomOptions(),
            supabase
              .from('rapot_siswa')
              .select('kelas_id, tahun_pelajaran, jenis, siswa_id, created_at, updated_at')
              .order('tahun_pelajaran', { ascending: false })
          ])
          if (homeroomError) throw homeroomError
          if (rapotHistoryError) throw rapotHistoryError
          const homeroomAssignments = toArray(homeroomRows)
          const assignedKelasIds = homeroomAssignments.map((row) => row.kelas_id).filter(Boolean)
          const historyKelasIds = toArray(rapotHistoryRows).map((row) => row.kelas_id).filter(Boolean)
          const kelasIds = Array.from(new Set([...assignedKelasIds, ...historyKelasIds].map(String).filter(Boolean)))

          if (!kelasIds.length) {
            return { kelas: [], options: [] }
          }

          const { data: kelasRows, error: kelasError } = await supabase
            .from('kelas')
            .select('id, nama, tingkat, jurusan, angkatan')
            .in('id', kelasIds)
            .order('nama')
          if (kelasError) throw kelasError
          const nextKelas = toArray(kelasRows)
          const kelasById = new Map(nextKelas.map((kelas) => [String(kelas.id), kelas]))
          const optionMap = new Map()
          homeroomAssignments.forEach((assignment) => {
            const normalizedId = String(assignment?.kelas_id || '')
            const year = String(assignment?.tahun_ajaran || '').trim()
            if (!normalizedId || !year) return
            const key = `${normalizedId}|${year}`
            optionMap.set(key, {
              key,
              kelasId: normalizedId,
              tahunPelajaran: year,
              status: assignment?.is_active ? 'aktif' : 'riwayat',
              kelasMeta: kelasById.get(normalizedId) || assignment?.kelas || { id: normalizedId, nama: normalizedId },
              rapotCount: 0
            })
          })
          toArray(rapotHistoryRows).forEach((row) => {
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

      const nextKelas = toArray(masterData.kelas)
      const options = toArray(masterData.options)

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
            .eq('semester', selectedSemester)

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
          let jadwalQuery = supabase
            .from('jadwal')
            .select('mapel, kelas_id')
            .in('kelas_id', aliases)
          if (tahunPelajaran) jadwalQuery = jadwalQuery.eq('tahun_ajaran', tahunPelajaran)

          const batch = await supabase.batch([
            { key: 'rapot', query: rapotQuery },
            { key: 'siswa', query: siswaQuery },
            { key: 'jadwal', query: jadwalQuery },
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
          const rapotRowsForPeriod = toArray(rapotResult?.data ?? rapotResult)
          const rapotStudentIds = Array.from(new Set(rapotRowsForPeriod.map((row) => row.siswa_id).filter(Boolean)))
          const jadwalRows = jadwalResult?.error ? [] : toArray(jadwalResult?.data ?? jadwalResult)

          let nextStudents = selectedHistory?.status === 'riwayat'
            ? []
            : toArray(siswaResult?.data ?? siswaResult).filter((row) => aliasSet.has(normalizeKelasKey(row.kelas)))
          if ((selectedHistory?.status === 'riwayat' || !nextStudents.length) && rapotStudentIds.length) {
            // For archived periods (riwayat), prefer student_class_histories so
            // we get the exact roster that was enrolled in this class during that
            // academic year, rather than whoever happens to have a rapot row.
            let historyStudentIds = rapotStudentIds
            const historyYear = (tahunPelajaran || '').trim()
            if (historyYear) {
              const { data: classHistoryRows } = await supabase
                .from('student_class_histories')
                .select('student_id')
                .eq('class_id', selectedKelas)
                .eq('tahun_ajaran', historyYear)
                .in('status', ['active', 'nonaktif', 'mutasi'])
              const historyFromClass = (classHistoryRows || [])
                .map((row) => row.student_id)
                .filter(Boolean)
              if (historyFromClass.length) {
                historyStudentIds = historyFromClass
              }
            }
            const { data: historyStudents, error: historyStudentsError } = await supabase
              .from('profiles')
              .select('id, nama, nis, nisn, kelas')
              .in('id', historyStudentIds)
              .order('nama')
            if (historyStudentsError) throw historyStudentsError
            nextStudents = toArray(historyStudents)
          }

          let mapels = Array.from(new Set((jadwalRows || [])
            .filter((row) => aliasSet.has(normalizeKelasKey(row.kelas_id)))
            .map((row) => String(row.mapel || '').trim())
            .filter(Boolean)))
            .sort((a, b) => a.localeCompare(b, 'id'))
          if (!mapels.length && !mapelMasterResult?.error) {
            mapels = Array.from(new Set(toArray(mapelMasterResult?.data ?? mapelMasterResult)
              .map((row) => String(row.nama || '').trim())
              .filter(Boolean)))
              .sort((a, b) => a.localeCompare(b, 'id'))
          }

          const nextIndex = {}
          rapotRowsForPeriod.forEach((row) => {
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
              toArray(itemRows).forEach((row) => {
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
  }, [applyClassData, pushToast, rapotClassQueryKey, selectedHistory?.status, selectedKelas, selectedKelasMeta, selectedSemester, tahunPelajaran])

  useEffect(() => {
    loadMaster()
  }, [loadMaster])

  useEffect(() => {
    loadClassData()
  }, [loadClassData])

  const openRapot = useCallback(async (student, type) => {
    const rapot = rapotIndex[`${student.id}|${type}`] || null
    setActiveModal({ student, type, rapot })

    if (!rapot?.id) {
      setRapotRows(makeDefaultRapotRows())
      return
    }

    const cachedItems = rapotItemsByRapotId[rapot.id] || []
    if (cachedItems.length) {
      setRapotRows(mergeSavedRapotItems(cachedItems))
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
      setRapotRows(mergeSavedRapotItems(savedItems))
      setRapotItemsByRapotId((prev) => ({ ...prev, [rapot.id]: savedItems }))
    } catch (error) {
      console.error(error)
      pushToast('error', error?.message || 'Gagal memuat detail rapot.')
    } finally {
      setLoading(false)
    }
  }, [
    makeDefaultRapotRows,
    mergeSavedRapotItems,
    pushToast,
    rapotIndex,
    rapotItemsByRapotId,
    setLoading,
  ])

  const computedTotal = useMemo(() => {
    return round2(rapotRows.reduce((sum, row) => sum + (toNumberOrNull(row.nilai) ?? 0), 0))
  }, [rapotRows])

  const computedAverage = useMemo(() => {
    const values = rapotRows.map((row) => toNumberOrNull(row.nilai)).filter((value) => value != null)
    if (!values.length) return null
    return round2(values.reduce((sum, value) => sum + value, 0) / values.length)
  }, [rapotRows])

  const displayedAverage = computedAverage

  const updateRow = (rowId, field, value) => {
    setRapotRows((prev) => prev.map((row) => row.id === rowId ? { ...row, [field]: value } : row))
  }

  const saveRapot = useCallback(async () => {
    if (!activeModal?.student || !activeModal?.type || !selectedKelas || !tahunPelajaran) return
    if (isViewingArchiveRapot) {
      pushToast('error', 'Rapot arsip hanya dapat dibaca. Gunakan sesi koreksi resmi untuk mengubahnya.')
      return
    }
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
          .eq('semester', selectedSemester)
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
        semester: selectedSemester,
        tahun_pelajaran: tahunPelajaran,
        jumlah: computedTotal,
        rata_rata: computedAverage,
        rata_rata_manual: false,
        locked_at: existingRapot?.locked_at || null,
        locked_by: existingRapot?.locked_by || null,
        created_by: existingRapot?.created_by || user?.id || null,
        updated_by: user?.id || null,
        created_at: existingRapot?.created_at || nowIso,
        updated_at: nowIso
      }
      const { error: rapotError } = await supabase
        .from('rapot_siswa')
        .upsert(rapotPayload, { onConflict: 'tenant_id,siswa_id,kelas_id,tahun_pelajaran,semester,jenis' })
      if (rapotError) throw rapotError

      const itemPayloads = rapotRows
        .filter((row) => String(row.mapel || '').trim())
        .map((row, index) => ({
          id: row.id || makeLocalId(),
          rapot_id: rapotId,
          nomor: Number(row.nomor || 0) || index + 1,
          mapel: String(row.mapel || '').trim(),
          kkm: toNumberOrNull(row.kkm),
          nilai: toNumberOrNull(row.nilai),
          predikat: getPredikat(row.nilai, row.kkm) || null,
          keterangan: String(row.keterangan || '').trim() || null,
          source: row.source || null,
          sent_by: row.sent_by || null,
          sent_at: row.sent_at || null,
          updated_at: nowIso,
          created_at: row.created_at || nowIso
        }))
      if (!itemPayloads.length) {
        pushToast('error', 'Belum ada mapel yang bisa disimpan untuk rapot ini.')
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
    computedAverage,
    computedTotal,
    isViewingArchiveRapot,
    loadClassData,
    pushToast,
    rapotClassQueryKey,
    rapotRows,
    selectedKelas,
    selectedSemester,
    tahunPelajaran,
    user?.id
  ])

  const toggleRapotLock = useCallback(async () => {
    if (!activeModal?.student || !activeModal?.type || !selectedKelas || !tahunPelajaran) return
    if (isViewingArchiveRapot) {
      pushToast('error', 'Kunci rapot arsip tidak dapat diubah tanpa sesi koreksi resmi.')
      return
    }

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
          semester: selectedSemester,
          tahun_pelajaran: tahunPelajaran,
          jumlah: computedTotal,
          rata_rata: computedAverage,
          rata_rata_manual: false,
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
        .upsert(payload, { onConflict: 'tenant_id,siswa_id,kelas_id,tahun_pelajaran,semester,jenis' })
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
    isViewingArchiveRapot,
    pushToast,
    rapotClassQueryKey,
    selectedKelas,
    selectedSemester,
    tahunPelajaran,
    computedAverage,
    user?.id
  ])

  const exportActiveRapotToExcel = useCallback(async () => {
    if (!activeModal) return
    try {
      setExportingRapot(true)
      const ExcelJS = await loadExcelJsBrowser()
      const workbook = new ExcelJS.Workbook()
      const worksheet = workbook.addWorksheet(`Rapot ${String(activeModal.type).toUpperCase()}`)
      const borderAll = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }

      worksheet.addRow([`RAPOT ${String(activeModal.type).toUpperCase()}`])
      worksheet.mergeCells(1, 1, 1, 6)
      worksheet.getCell('A1').font = { bold: true, size: 15 }
      worksheet.getCell('A1').alignment = { horizontal: 'center' }
      worksheet.addRow([`Nama`, activeModal.student.nama || '-', `NIS`, activeModal.student.nis || '-', `NISN`, activeModal.student.nisn || '-'])
      worksheet.addRow([`Kelas`, getKelasDisplayName(selectedKelasMeta) || '-', `Semester`, selectedSemester || '-', `Tahun Pelajaran`, tahunPelajaran || '-'])
      worksheet.addRow([`Jumlah`, computedTotal ?? '-', `Rata-rata`, displayedAverage ?? '-', `Status`, activeModal.rapot?.locked_at ? 'Dikunci' : 'Terbuka'])
      worksheet.addRow([])

      const header = worksheet.addRow(['No', 'Mapel', 'KKM', 'Nilai', 'Predikat', 'Keterangan'])
      header.font = { bold: true }
      header.eachCell((cell) => {
        cell.border = borderAll
        cell.alignment = { horizontal: 'center' }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
      })

      rapotRows.forEach((row, index) => {
        const excelRow = worksheet.addRow([
          index + 1,
          row.mapel || '',
          row.kkm ?? '',
          row.nilai ?? '',
          getPredikat(row.nilai, row.kkm) || '',
          row.keterangan || ''
        ])
        excelRow.eachCell((cell, colNumber) => {
          cell.border = borderAll
          cell.alignment = { horizontal: colNumber === 2 || colNumber === 6 ? 'left' : 'center' }
        })
      })

      worksheet.columns.forEach((column) => {
        let maxLength = 12
        column.eachCell({ includeEmpty: true }, (cell) => {
          maxLength = Math.max(maxLength, String(cell.value ?? '').length + 2)
        })
        column.width = Math.min(Math.max(maxLength, 12), 42)
      })

      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      const safeName = String(activeModal.student.nama || 'siswa').replace(/[^\w-]+/g, '_')
      anchor.href = url
      anchor.download = `Rapot_${String(activeModal.type).toUpperCase()}_${safeName}_${tahunPelajaran || 'tahun'}.xlsx`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error(error)
      pushToast('error', error?.message || 'Gagal export rapot.')
    } finally {
      setExportingRapot(false)
    }
  }, [
    activeModal,
    computedTotal,
    displayedAverage,
    pushToast,
    rapotRows,
    selectedKelasMeta,
    selectedSemester,
    tahunPelajaran
  ])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-4 font-sans text-slate-900 sm:p-6">
      <div className="mx-auto max-w-full space-y-6">
        <section className="page-title-card">
          <div className="page-title-layout">
            <div className="page-title-main">
              <div className="page-title-icon bg-blue-100 text-blue-700">
                <BookOpenCheck className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <p className="page-title-kicker">Wali Kelas</p>
                <h1 className="page-title-heading">Rapot Siswa</h1>
                <p className="page-title-description">Kelola rapot tengah dan akhir semester siswa wali secara terstruktur.</p>
              </div>
            </div>
            <div className="page-title-actions w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:w-[520px]">
              <div className="grid w-full gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
                <div>
                <label className={metricLabelClass}>Kelas / Riwayat Wali</label>
                <select
                  value={selectedContext}
                  onChange={(event) => setSelectedContext(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
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
                <div>
                  <label className={metricLabelClass}>Semester</label>
                  <select
                    value={selectedSemester}
                    onChange={(event) => setSelectedSemester(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                  >
                    <option value="Ganjil">Ganjil</option>
                    <option value="Genap">Genap</option>
                  </select>
                </div>
              </div>
              {isViewingArchiveRapot && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                  Mode arsip aktif. Data dapat dibaca dan diekspor, tetapi perubahan nilai maupun kunci rapot dinonaktifkan.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className={metricLabelClass}>Kelas</p>
              <p className={metricValueClass}>{getKelasDisplayName(selectedKelasMeta) || '-'}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className={metricLabelClass}>Tahun Pelajaran</p>
              <p className={metricValueClass}>{tahunPelajaran || '-'}</p>
            </div>
            <div className={`rounded-2xl border p-4 ${
              selectedHistory?.status === 'riwayat'
                ? 'border-amber-200 bg-amber-50'
                : 'border-emerald-200 bg-emerald-50'
            }`}>
              <p className={`text-xs font-semibold uppercase tracking-wide ${
                selectedHistory?.status === 'riwayat' ? 'text-amber-700' : 'text-emerald-700'
              }`}>Status Wali</p>
              <p className={metricValueClass}>
                {selectedHistory?.status === 'riwayat' ? 'Riwayat' : 'Aktif'}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className={metricLabelClass}>Jumlah Siswa</p>
              <p className={metricValueClass}>{students.length}</p>
            </div>
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Format Rapot</p>
              <p className={metricValueClass}>{assessmentLabels.midterm.short} & {assessmentLabels.final.short}</p>
            </div>
          </div>

          <div className="mb-4 flex flex-col gap-1 border-b border-slate-100 pb-4">
            <h2 className="text-lg font-semibold text-slate-950">Daftar Siswa Wali</h2>
            <p className="text-sm text-slate-500">Klik detail {assessmentLabels.midterm.formal} atau {assessmentLabels.final.formal} untuk membuka pengisian rapot siswa.</p>
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
              <thead className="bg-slate-50">
                <tr>
                  <th className={`${tableHeaderClass} text-left`}>Nama</th>
                  <th className={`${tableHeaderClass} text-left`}>NIS</th>
                  <th className={`${tableHeaderClass} text-center`}>{assessmentLabels.midterm.formal}</th>
                  <th className={`${tableHeaderClass} text-center`}>{assessmentLabels.final.formal}</th>
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
                            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                              rapot
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-indigo-200 bg-indigo-50 text-indigo-700'
                            }`}
                          >
                            {rapot
                              ? `Detail ${assessmentLabels[type.labelKey].short}`
                              : `Isi ${assessmentLabels[type.labelKey].short}`}
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
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
                    Rapot {activeModal.type === 'uas' ? assessmentLabels.final.formal : assessmentLabels.midterm.formal}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-950">{activeModal.student.nama}</h2>
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
                    {[
                      ['NIS', activeModal.student.nis || '-'],
                      ['NISN', activeModal.student.nisn || '-'],
                      ['Kelas', getKelasDisplayName(selectedKelasMeta) || '-'],
                      ['Tahun', tahunPelajaran || '-'],
                      ['Semester', selectedSemester || '-']
                    ].map(([label, value]) => (
                      <span key={label} className="text-slate-500">
                        {label}: <span className="font-semibold text-slate-800">{value}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Tutup
                </button>
              </div>

              <div className="p-5 overflow-x-auto">
                <table className="w-full min-w-[840px] text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className={`${modalTableHeaderClass} w-16 text-center`}>No</th>
                      <th className={`${modalTableHeaderClass} text-left`}>Mapel</th>
                      <th className={`${modalTableHeaderClass} w-28 text-center`}>KKM</th>
                      <th className={`${modalTableHeaderClass} w-32 text-center`}>Nilai</th>
                      <th className={`${modalTableHeaderClass} w-28 text-center`}>Predikat</th>
                      <th className={`${modalTableHeaderClass} text-left`}>Keterangan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rapotRows.map((row, index) => (
                      <tr key={row.id}>
                        <td className="px-3 py-3 text-center font-semibold">{index + 1}</td>
                        <td className="px-3 py-3">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="font-semibold text-slate-900">{row.mapel || '-'}</div>
                            <div className="mt-1 text-[11px] text-slate-500">
                              {SOURCE_LABELS[row.source] || (toNumberOrNull(row.nilai) != null ? 'Tersimpan di rapot' : 'Belum dikirim guru mapel')}
                              {row.sent_at ? ` • ${new Date(row.sent_at).toLocaleString('id-ID')}` : ''}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={row.kkm ?? ''}
                            disabled={isViewingArchiveRapot}
                            onChange={(event) => updateRow(row.id, 'kkm', event.target.value)}
                            className={`${inputClass} text-center`}
                            placeholder="KKM"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <div className={`rounded-lg border px-3 py-2 text-center text-sm font-semibold ${buildScoreTone(row.nilai, row.kkm)}`}>
                            {toNumberOrNull(row.nilai) != null ? row.nilai : '-'}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-flex min-w-[42px] justify-center rounded-lg border px-2 py-1 text-sm font-semibold ${buildScoreTone(row.nilai, row.kkm)}`}>
                            {getPredikat(row.nilai, row.kkm) || '-'}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <input
                            value={row.keterangan}
                            disabled={isViewingArchiveRapot}
                            onChange={(event) => updateRow(row.id, 'keterangan', event.target.value)}
                            className={inputClass}
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
                      <div className={metricLabelClass}>Jumlah</div>
                      <div className="text-2xl font-semibold text-slate-950">{computedTotal}</div>
                    </div>
                    <div>
                      <div className={metricLabelClass}>Rata-rata</div>
                      <div className="text-2xl font-semibold text-slate-950">{displayedAverage ?? '-'}</div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700">
                    Nilai rapot otomatis dari kiriman guru mapel. Wali kelas dapat mengatur KKM, keterangan, dan mengunci arsip rapot.
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 p-5 flex justify-end gap-3">
                <button
                  type="button"
                  disabled={exportingRapot}
                  onClick={exportActiveRapotToExcel}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                >
                  {exportingRapot ? 'Menyiapkan...' : 'Export Excel'}
                </button>
                <button
                  type="button"
                  disabled={saving || isViewingArchiveRapot}
                  onClick={toggleRapotLock}
                  className={`rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60 ${
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
                  className={secondaryButtonClass}
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={saving || isViewingArchiveRapot}
                  onClick={saveRapot}
                  className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
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
