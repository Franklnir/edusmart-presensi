import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
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
  const [selectedKelas, setSelectedKelas] = useState('')
  const [students, setStudents] = useState([])
  const [mapelOptions, setMapelOptions] = useState([])
  const [rapotIndex, setRapotIndex] = useState({})
  const [activeModal, setActiveModal] = useState(null)
  const [rapotRows, setRapotRows] = useState([])
  const [semesterText, setSemesterText] = useState('')
  const [averageManual, setAverageManual] = useState('')
  const [useManualAverage, setUseManualAverage] = useState(false)
  const [saving, setSaving] = useState(false)

  const tahunPelajaran = period?.tahunAjaran || ''
  const selectedKelasMeta = useMemo(
    () => waliKelasList.find((kelas) => String(kelas.id) === String(selectedKelas)) || null,
    [selectedKelas, waliKelasList]
  )

  const loadMaster = useCallback(async () => {
    if (!user?.id) return
    try {
      setLoading(true)
      const { data: strukturRows, error: strukturError } = await supabase
        .from('kelas_struktur')
        .select('kelas_id')
        .eq('wali_guru_id', user.id)
      if (strukturError) throw strukturError
      const kelasIds = (strukturRows || []).map((row) => row.kelas_id).filter(Boolean)
      if (!kelasIds.length) {
        setWaliKelasList([])
        setSelectedKelas('')
        setStudents([])
        return
      }

      const { data: kelasRows, error: kelasError } = await supabase
        .from('kelas')
        .select('id, nama, tingkat, jurusan, angkatan')
        .in('id', kelasIds)
        .order('nama')
      if (kelasError) throw kelasError
      const nextKelas = kelasRows || []
      setWaliKelasList(nextKelas)
      setSelectedKelas((prev) => nextKelas.some((kelas) => String(kelas.id) === String(prev))
        ? prev
        : String(nextKelas[0]?.id || ''))
    } catch (error) {
      console.error(error)
      pushToast('error', error?.message || 'Gagal memuat kelas wali.')
    } finally {
      setLoading(false)
    }
  }, [pushToast, setLoading, user?.id])

  const loadClassData = useCallback(async () => {
    if (!selectedKelas) return
    try {
      setLoading(true)
      const aliases = buildKelasAliases(selectedKelas, selectedKelasMeta)
      const aliasSet = new Set(aliases.map((value) => normalizeKelasKey(value)))

      let siswaQuery = supabase
        .from('profiles')
        .select('id, nama, nis, nisn, kelas')
        .eq('role', 'siswa')
        .order('nama')
      siswaQuery = aliases.length === 1 ? siswaQuery.eq('kelas', aliases[0]) : siswaQuery.in('kelas', aliases)
      const [{ data: siswaRows, error: siswaError }, { data: jadwalRows, error: jadwalError }] = await Promise.all([
        siswaQuery,
        supabase
          .from('jadwal')
          .select('mapel, kelas_id')
          .eq('kelas_id', selectedKelas)
      ])
      if (siswaError) throw siswaError
      if (jadwalError) throw jadwalError

      const nextStudents = (siswaRows || []).filter((row) => aliasSet.has(normalizeKelasKey(row.kelas)))
      setStudents(nextStudents)
      let nextJadwalRows = jadwalRows || []
      let mapels = Array.from(new Set((nextJadwalRows || [])
        .filter((row) => String(row.kelas_id || '') === String(selectedKelas))
        .map((row) => String(row.mapel || '').trim())
        .filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'id'))
      if (!mapels.length) {
        const { data: fallbackMapelRows, error: fallbackMapelError } = await supabase
          .from('mata_pelajaran')
          .select('nama')
          .order('nama')
        if (fallbackMapelError) throw fallbackMapelError
        mapels = Array.from(new Set((fallbackMapelRows || [])
          .map((row) => String(row.nama || '').trim())
          .filter(Boolean)))
          .sort((a, b) => a.localeCompare(b, 'id'))
      }
      setMapelOptions(mapels)

      if (nextStudents.length) {
        const { data, error } = await supabase
          .from('rapot_siswa')
          .select('id, siswa_id, jenis, semester, tahun_pelajaran, jumlah, rata_rata, rata_rata_manual, created_by, created_at')
          .eq('kelas_id', selectedKelas)
          .eq('tahun_pelajaran', tahunPelajaran)
          .in('siswa_id', nextStudents.map((student) => student.id))
        if (error) throw error
        const nextIndex = {}
        ;(data || []).forEach((row) => {
          nextIndex[`${row.siswa_id}|${row.jenis}`] = row
        })
        setRapotIndex(nextIndex)
      } else {
        setRapotIndex({})
      }
    } catch (error) {
      console.error(error)
      pushToast('error', error?.message || 'Gagal memuat data rapot.')
    } finally {
      setLoading(false)
    }
  }, [pushToast, selectedKelas, selectedKelasMeta, setLoading, tahunPelajaran])

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
      setRapotRows((mapelOptions.length ? mapelOptions : ['']).map((mapel, index) => ({
        id: makeLocalId(),
        nomor: index + 1,
        mapel,
        kkm: 75,
        nilai: '',
        keterangan: ''
      })))
      return
    }

    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('rapot_siswa_items')
        .select('*')
        .eq('rapot_id', rapot.id)
        .order('nomor')
      if (error) throw error
      setRapotRows((data || []).map((row) => ({
        id: row.id,
        nomor: row.nomor,
        mapel: row.mapel,
        kkm: row.kkm ?? 75,
        nilai: row.nilai ?? '',
        keterangan: row.keterangan || ''
      })))
    } catch (error) {
      console.error(error)
      pushToast('error', error?.message || 'Gagal memuat detail rapot.')
    } finally {
      setLoading(false)
    }
  }, [mapelOptions, period?.semester, pushToast, rapotIndex, setLoading])

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

    try {
      setSaving(true)
      const rapotId = activeModal.rapot?.id || makeLocalId()
      const nowIso = new Date().toISOString()
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
        created_by: activeModal.rapot?.created_by || user?.id || null,
        updated_by: user?.id || null,
        created_at: activeModal.rapot?.created_at || nowIso,
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
      if (itemPayloads.length) {
        const { error: itemsError } = await supabase
          .from('rapot_siswa_items')
          .upsert(itemPayloads, { onConflict: 'tenant_id,rapot_id,nomor' })
        if (itemsError) throw itemsError
      }
      pushToast('success', 'Rapot siswa berhasil disimpan.')
      setActiveModal(null)
      await loadClassData()
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
    rapotRows,
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
            <div className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:w-[320px]">
              <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Kelas Wali</label>
              <select
                value={selectedKelas}
                onChange={(event) => setSelectedKelas(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              >
                {waliKelasList.map((kelas) => (
                  <option key={kelas.id} value={kelas.id}>{getKelasDisplayName(kelas)}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm">
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase text-slate-500">Kelas</p>
              <p className="mt-1 text-lg font-black text-slate-950">{getKelasDisplayName(selectedKelasMeta) || '-'}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase text-slate-500">Tahun Pelajaran</p>
              <p className="mt-1 text-lg font-black text-slate-950">{tahunPelajaran || '-'}</p>
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
                {students.map((student) => (
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
                {!students.length && (
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
