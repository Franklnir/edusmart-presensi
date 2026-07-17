import { useEffect, useRef } from 'react'
import { supabase } from '../../../services/storageService'
import { getToday, toMinutes } from '../utils/attendanceDate'

export function useStudentRfidAttendanceListener({
  academicPeriodPayload,
  isInRfidTimeRange,
  jadwalRef,
  profile,
  pushToast,
  refreshFnsRef,
  setCurrentJadwal,
  setCurrentJadwalIndex,
  setMapel,
  setRfidListening,
  setStatus,
  setTgl,
  userId,
}) {
  const rfidChannelRef = useRef(null)

  useEffect(() => {
    if (!profile?.rfid_uid || !userId) return

    const cardUid = (profile.rfid_uid || '')
      .toUpperCase()
      .replace(/\s+/g, '')
    if (!cardUid) return

    const handleRfidEvent = async (payload) => {
      const scan = payload.new
      if (!scan || (scan.status && String(scan.status).toLowerCase() !== 'raw')) return

      const scanTime = scan.created_at ? new Date(scan.created_at) : new Date()
      const todayKey = getToday()
      const scanDateKey = scanTime.toISOString().slice(0, 10)

      if (scanDateKey !== todayKey) return

      if (!isInRfidTimeRange()) {
        pushToast(
          'warning',
          'Kartu RFID terbaca, tetapi di luar waktu yang ditentukan untuk absensi RFID.'
        )
        return
      }

      const scanMinutes = scanTime.getHours() * 60 + scanTime.getMinutes()
      const jadwalList = jadwalRef.current || []
      const jadwalAktif = jadwalList.find((j) => {
        const start = toMinutes(j.jam_mulai)
        const end = toMinutes(j.jam_selesai)
        return scanMinutes >= start && scanMinutes <= end
      })

      if (!jadwalAktif) {
        pushToast(
          'warning',
          'Kartu RFID terbaca, tetapi tidak ada jadwal pelajaran yang aktif.'
        )
        return
      }

      if (jadwalAktif.mode !== 'otomatis') {
        pushToast(
          'warning',
          `Scan RFID untuk ${jadwalAktif.mapel}, tetapi mode absensi masih MANUAL.`
        )
        return
      }

      try {
        const nowIso = new Date().toISOString()
        const payloadAbsensi = {
          kelas: profile.kelas,
          tanggal: todayKey,
          uid: userId,
          mapel: jadwalAktif.mapel,
          status: 'Hadir',
          nama: profile.nama,
          waktu: nowIso,
          komentar: `Absen via RFID (${scan.device_id || 'device'})`,
          oleh: 'rfid',
          ...academicPeriodPayload
        }

        const { error } = await supabase
          .from('absensi')
          .upsert(payloadAbsensi, {
            onConflict: 'kelas,tanggal,mapel,uid'
          })

        if (error) {
          console.error('[RFID-SISWA] Error upsert absensi:', error)
          pushToast('error', 'Gagal menyimpan absensi dari RFID')
          return
        }

        try {
          await supabase
            .from('rfid_scans')
            .update({ status: 'processed' })
            .eq('id', scan.id)
        } catch (e) {
          console.warn('Gagal update status rfid_scans:', e)
        }

        setStatus('Hadir')
        setTgl(todayKey)
        setMapel(jadwalAktif.mapel)

        const idx = jadwalList.findIndex((j) => j.mapel === jadwalAktif.mapel)
        if (idx !== -1) {
          setCurrentJadwalIndex(idx)
          setCurrentJadwal(jadwalList[idx])
        }

        pushToast(
          'success',
          `Absensi berhasil melalui kartu RFID (${jadwalAktif.mapel})`
        )

        const {
          loadRingkasDanStatus: refreshRingkas,
          loadJadwalHariIni: refreshJadwal,
          loadStatistikKehadiran: refreshStatistik
        } = refreshFnsRef.current

        if (refreshRingkas) refreshRingkas()
        if (refreshJadwal) refreshJadwal()
        if (refreshStatistik) refreshStatistik()
      } catch (err) {
        console.error('[RFID-SISWA] Error handle scan:', err)
        pushToast('error', 'Terjadi kesalahan saat memproses RFID')
      }
    }

    const channel = supabase
      .channel(`rfid-absen-siswa-${cardUid}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'rfid_scans',
          filter: `card_uid=eq.${cardUid}`
        },
        handleRfidEvent
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRfidListening(true)
        else if (
          status === 'CHANNEL_ERROR' ||
          status === 'CLOSED' ||
          status === 'TIMED_OUT'
        ) {
          setRfidListening(false)
        }
      })

    rfidChannelRef.current = channel
    return () => {
      setRfidListening(false)
      if (rfidChannelRef.current) supabase.removeChannel(rfidChannelRef.current)
    }
  }, [
    academicPeriodPayload,
    isInRfidTimeRange,
    jadwalRef,
    profile?.kelas,
    profile?.nama,
    profile?.rfid_uid,
    pushToast,
    refreshFnsRef,
    setCurrentJadwal,
    setCurrentJadwalIndex,
    setMapel,
    setRfidListening,
    setStatus,
    setTgl,
    userId,
  ])
}
