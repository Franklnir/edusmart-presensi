import React, { useCallback, useEffect, useMemo, useState } from 'react'
import ProfileAvatar from '../../../components/ProfileAvatar'
import { supabase } from '../../../services/storageService'
import { compareStudentsByAttendanceOrder } from '../../../utils/studentOrdering'

export default function RingkasanKelasTable({
  kelas,
  mapel,
  tanggal,
  selfUserId,
  canClickHadir,
  canClickIzin,
  izinDisabledReason,
  onHadir,
  onIzin,
  periodFilter
}) {
  const [dataSiswa, setDataSiswa] = useState([])
  const [isLoading, setIsLoading] = useState(false)

  const loadDataSiswa = useCallback(async () => {
    if (!kelas || !tanggal) {
      setDataSiswa([])
      return
    }

    setIsLoading(true)
    try {
      let siswaData = []
      let siswaError = null

      ; ({ data: siswaData, error: siswaError } = await supabase
        .from('profiles')
        .select('id, nama, photo_url, photo_path, nis, kelas')
        .eq('role', 'siswa')
        .eq('kelas', kelas)
        .order('nama'))

      if (siswaError && /photo_path/i.test(siswaError.message || '')) {
        ; ({ data: siswaData, error: siswaError } = await supabase
          .from('profiles')
          .select('id, nama, photo_url, nis, kelas')
          .eq('role', 'siswa')
          .eq('kelas', kelas)
          .order('nama'))
      }

      if (siswaError) throw siswaError

      let absensiData = []
      if (mapel) {
        let absensiQuery = supabase
          .from('absensi')
          .select('uid, status, komentar, oleh, waktu, nama')
          .eq('kelas', kelas)
          .eq('mapel', mapel)
          .eq('tanggal', tanggal)
        if (periodFilter?.tahunAjaran) absensiQuery = absensiQuery.eq('tahun_ajaran', periodFilter.tahunAjaran)
        if (periodFilter?.semester) absensiQuery = absensiQuery.eq('semester', periodFilter.semester)
        const { data, error: absensiError } = await absensiQuery

        if (absensiError) throw absensiError
        absensiData = data || []
      }

      const absensiByUid = new Map((absensiData || []).map((a) => [a.uid, a]))
      const mapped = (siswaData || []).map((s) => {
        const absen = absensiByUid.get(s.id)
        return {
          id: s.id,
          nama: s.nama || absen?.nama || 'Tanpa Nama',
          foto: s.photo_path || s.photo_url || null,
          nis: s.nis || null,
          kelas: s.kelas || kelas,
          status: absen?.status || null,
          komentar: absen?.komentar || '',
          oleh: absen?.oleh || '',
          waktu: absen?.waktu || ''
        }
      })

      const existingIds = new Set(mapped.map((s) => s.id))
      ; (absensiData || []).forEach((abs) => {
        if (!existingIds.has(abs.uid)) {
          mapped.push({
            id: abs.uid,
            nama: abs.nama || 'Tanpa Nama',
            foto: null,
            nis: null,
            kelas,
            status: abs.status || null,
            komentar: abs.komentar || '',
            oleh: abs.oleh || '',
            waktu: abs.waktu || ''
          })
        }
      })

      mapped.sort(compareStudentsByAttendanceOrder)
      setDataSiswa(mapped)
    } catch (error) {
      console.error('Error loading data siswa:', error)
    } finally {
      setIsLoading(false)
    }
  }, [kelas, mapel, tanggal, periodFilter?.semester, periodFilter?.tahunAjaran])

  useEffect(() => {
    loadDataSiswa()
  }, [loadDataSiswa])

  useEffect(() => {
    if (!kelas || !mapel || !tanggal) return

    const channel = supabase
      .channel(`absensi-kelas-table-${kelas}-${mapel}-${tanggal}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absensi',
          filter: `tanggal=eq.${tanggal}`
        },
        (payload) => {
          const row = payload.new || payload.old
          if (row && row.kelas === kelas && row.mapel === mapel && row.tanggal === tanggal) {
            loadDataSiswa()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [kelas, mapel, tanggal, loadDataSiswa])

  const getStatusColor = (status) => {
    switch (status) {
      case 'Hadir':
        return 'bg-green-50/70 hover:bg-green-50'
      case 'Izin':
        return 'bg-yellow-50/70 hover:bg-yellow-50'
      case 'Sakit':
        return 'bg-blue-50/70 hover:bg-blue-50'
      case 'Alpha':
        return 'bg-red-50/70 hover:bg-red-50'
      default:
        return 'bg-white hover:bg-slate-50'
    }
  }

  const getStatusBadgeClass = (status) => {
    if (!mapel) return 'bg-slate-100 text-slate-700 border border-slate-200'
    switch (status) {
      case 'Hadir':
        return 'bg-green-100 text-green-800 border border-green-200'
      case 'Izin':
        return 'bg-yellow-100 text-yellow-800 border border-yellow-200'
      case 'Sakit':
        return 'bg-blue-100 text-blue-800 border border-blue-200'
      case 'Alpha':
        return 'bg-red-100 text-red-800 border border-red-200'
      default:
        return 'bg-slate-100 text-slate-700 border border-slate-200'
    }
  }

  const getDetailAbsensi = (siswa) => {
    if (!mapel) return 'Pilih mapel terlebih dahulu'
    if (!siswa.status) return 'Belum ada absensi'
    if (siswa.status !== 'Hadir') return siswa.komentar || siswa.status
    if ((siswa.komentar || '').includes('RFID') || siswa.oleh === 'rfid') return 'Via RFID'
    if ((siswa.komentar || '').includes('mandiri') || siswa.oleh === 'siswa') return 'Absen Mandiri'
    if (siswa.oleh === 'guru') return 'Diabsen Guru'
    if (siswa.oleh === 'system') return 'Auto System'
    return siswa.komentar || 'Hadir'
  }

  const getJamStatus = (waktu) => {
    if (!waktu) return '-'
    const parsed = new Date(waktu)
    if (Number.isNaN(parsed.getTime())) return '-'
    return parsed.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  }

  const statusSummary = useMemo(() => {
    return (dataSiswa || []).reduce(
      (acc, siswa) => {
        const status = siswa?.status || 'Belum Absen'
        if (status === 'Hadir') acc.Hadir += 1
        else if (status === 'Izin') acc.Izin += 1
        else if (status === 'Sakit') acc.Sakit += 1
        else if (status === 'Alpha') acc.Alpha += 1
        else acc.Belum += 1
        acc.Total += 1
        return acc
      },
      { Hadir: 0, Izin: 0, Sakit: 0, Alpha: 0, Belum: 0, Total: 0 }
    )
  }, [dataSiswa])

  const summaryItems = [
    {
      key: 'Hadir',
      label: 'Hadir',
      value: statusSummary.Hadir,
      className: 'border-green-200 bg-green-50 text-green-700'
    },
    {
      key: 'Izin',
      label: 'Izin',
      value: statusSummary.Izin,
      className: 'border-yellow-200 bg-yellow-50 text-yellow-700'
    },
    {
      key: 'Sakit',
      label: 'Sakit',
      value: statusSummary.Sakit,
      className: 'border-blue-200 bg-blue-50 text-blue-700'
    },
    {
      key: 'Alpha',
      label: 'Alpha',
      value: statusSummary.Alpha,
      className: 'border-red-200 bg-red-50 text-red-700'
    },
    {
      key: 'Belum',
      label: 'Belum Absen',
      value: statusSummary.Belum,
      className: 'border-slate-200 bg-slate-50 text-slate-700'
    }
  ]

  const renderAction = (siswa, hasStatus) => {
    const isSelf = siswa.id === selfUserId
    if (!isSelf) {
      return <span className="text-[11px] text-slate-400">-</span>
    }

    if (hasStatus) {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
          Selesai
        </span>
      )
    }

    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onHadir}
          disabled={!canClickHadir}
          className={`min-h-9 px-4 py-2 rounded-xl text-xs font-bold leading-none whitespace-nowrap shadow-sm transition-all ${!canClickHadir
            ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
            : 'bg-green-600 hover:bg-green-700 text-white shadow-green-100'
            }`}
        >
          Hadir
        </button>
        <button
          type="button"
          onClick={onIzin}
          disabled={!canClickIzin}
          title={
            canClickIzin
              ? 'Ajukan izin'
              : izinDisabledReason || 'Ajukan izin tidak tersedia'
          }
          className={`min-h-9 px-4 py-2 rounded-xl text-xs font-bold leading-none whitespace-nowrap shadow-sm transition-all ${!canClickIzin
            ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
            : 'bg-yellow-500 hover:bg-yellow-600 text-white shadow-yellow-100'
            }`}
        >
          Ajukan Izin
        </button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="text-center py-6">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-slate-600 text-xs">Memuat daftar siswa...</p>
      </div>
    )
  }

  if (!dataSiswa.length) {
    return (
      <div className="text-xs text-slate-500 italic">
        Belum ada data siswa untuk kelas ini.
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-sm font-bold text-slate-900">
              Ringkasan Status Mapel Ini
            </h4>
            <p className="text-[11px] text-slate-500">
              {mapel
                ? `${mapel} • ${tanggal}`
                : 'Pilih mapel untuk melihat status sesuai sesi.'}
            </p>
          </div>
          <span className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700">
            Total {statusSummary.Total} siswa
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {summaryItems.map((item) => (
            <div
              key={item.key}
              className={`rounded-2xl border px-3 py-2.5 ${item.className}`}
            >
              <div className="text-[11px] font-semibold">{item.label}</div>
              <div className="mt-1 text-2xl font-bold">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm md:block">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50/90 border-b border-slate-200">
              <th className="text-left px-3 py-2.5 font-semibold text-slate-700 w-12">No</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-700">Siswa</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-700">NIS</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-700">Status</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-700">Jam</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-700">Detail</th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-700 min-w-[190px]">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {dataSiswa.map((siswa, idx) => {
              const isSelf = siswa.id === selfUserId
              const hasStatus = !!siswa.status

              return (
                <tr
                  key={siswa.id}
                  className={`border-b border-slate-100 transition-colors ${getStatusColor(
                    siswa.status
                  )} ${isSelf ? 'ring-1 ring-inset ring-blue-200' : ''}`}
                >
                  <td className="px-3 py-2.5 text-slate-600 font-medium">{idx + 1}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center space-x-2">
                      <ProfileAvatar
                        src={siswa.foto}
                        name={siswa.nama}
                        size={30}
                        className="border-slate-300"
                      />
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 text-xs">
                          {siswa.nama}
                        </span>
                        {isSelf && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-blue-100 text-blue-700 border border-blue-200 font-semibold">
                            Anda
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 text-[11px]">
                    {siswa.nis || '-'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full font-semibold text-[11px] ${getStatusBadgeClass(
                        siswa.status
                      )}`}
                    >
                      {!mapel ? 'Pilih Mapel' : siswa.status || 'Belum Absen'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] font-semibold text-slate-700">
                    {siswa.status === 'Hadir' ? getJamStatus(siswa.waktu) : '-'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[11px] text-slate-700 leading-relaxed">
                      {getDetailAbsensi(siswa)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 min-w-[190px]">
                    {renderAction(siswa, hasStatus)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {dataSiswa.map((siswa, idx) => {
          const isSelf = siswa.id === selfUserId
          const hasStatus = !!siswa.status
          return (
            <div
              key={siswa.id}
              className={`rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ${getStatusColor(
                siswa.status
              )} ${isSelf ? 'ring-1 ring-blue-200' : ''}`}
            >
              <div className="flex items-start gap-3">
                <div className="pt-1 text-xs font-bold text-slate-500">{idx + 1}</div>
                <ProfileAvatar
                  src={siswa.foto}
                  name={siswa.nama}
                  size={36}
                  className="border-slate-300"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{siswa.nama}</span>
                    {isSelf && (
                      <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                        Anda
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    NIS: {siswa.nis || '-'}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${getStatusBadgeClass(
                    siswa.status
                  )}`}
                >
                  {!mapel ? 'Pilih Mapel' : siswa.status || 'Belum Absen'}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-xl border border-slate-200 bg-white/70 p-2">
                  <div className="font-semibold text-slate-500">Jam</div>
                  <div className="font-bold text-slate-800">
                    {siswa.status === 'Hadir' ? getJamStatus(siswa.waktu) : '-'}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white/70 p-2">
                  <div className="font-semibold text-slate-500">Detail</div>
                  <div className="font-bold text-slate-800">{getDetailAbsensi(siswa)}</div>
                </div>
              </div>
              <div className="mt-3">
                {renderAction(siswa, hasStatus)}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-2 text-[11px] text-slate-500">
        Menampilkan {dataSiswa.length} siswa. Baris akun Anda diberi label <span className="font-semibold">Anda</span>.
      </div>
    </div>
  )
}
