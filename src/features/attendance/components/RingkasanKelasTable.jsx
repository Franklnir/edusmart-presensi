import React, { useCallback, useEffect, useState } from 'react'
import ProfileAvatar from '../../../components/ProfileAvatar'
import { supabase } from '../../../lib/supabase'

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

      mapped.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''))
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
    <div className="mt-3">
      <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm">
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
                    {isSelf ? (
                      hasStatus ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                          Selesai
                        </span>
                      ) : (
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
                    ) : (
                      <span className="text-[11px] text-slate-400">-</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">
        Menampilkan {dataSiswa.length} siswa. Baris akun Anda diberi label <span className="font-semibold">Anda</span>.
      </div>
    </div>
  )
}
