import { useCallback, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { extractQrToken } from '../utils/qrToken'
import { getToday, toMinutes } from '../utils/attendanceDate'
import { attendanceService } from '../../../services/attendanceService'

export function useStudentAttendanceActions({
  academicPeriodPayload,
  currentJadwal,
  currentMinutes,
  isSubmitting,
  izinAvailability,
  jadwalRef,
  loadJadwalHariIni,
  loadRingkasDanStatus,
  loadStatistikKehadiran,
  mapel,
  profile,
  pushToast,
  refreshFnsRef,
  setCurrentJadwal,
  setCurrentJadwalIndex,
  setIsSubmitting,
  setMapel,
  setStatus,
  setTgl,
  statusRef,
  tgl,
  userId,
}) {
  const [isIzinModalOpen, setIsIzinModalOpen] = useState(false)
  const [izinReason, setIzinReason] = useState('')
  const [isQrSubmitting, setIsQrSubmitting] = useState(false)
  const [qrScanError, setQrScanError] = useState('')
  const [qrSuccessData, setQrSuccessData] = useState(null)

  const isManualAbsenAllowed = useCallback(() => {
    return Boolean(currentJadwal?.allow_self_absen)
  }, [currentJadwal?.allow_self_absen])

  const saveAbsensi = useCallback(async (st, komentar) => {
    const nowIso = new Date().toISOString()
    const payload = {
      kelas: profile.kelas,
      tanggal: tgl,
      uid: userId,
      mapel,
      status: st,
      nama: profile.nama,
      waktu: nowIso,
      komentar,
      oleh: 'siswa',
      ...academicPeriodPayload
    }

    const useApiV2 = import.meta.env.VITE_USE_ATTENDANCE_API_V2 === 'true'

    if (useApiV2) {
      const error = new Error('Absen mandiri API V2 belum tersedia; gunakan QR atau ajukan izin.')
      error.code = 'ATTENDANCE_SELF_SERVICE_UNAVAILABLE'
      throw error
    } else {
      const res = await apiClient('/api/v2/attendance', { method: 'POST', body: JSON.stringify(payload) })
      const error = null
      if (error) throw error
    }

    setStatus(st)
    statusRef.current = st
    pushToast('success', 'Absensi tersimpan')
    loadRingkasDanStatus()
    loadJadwalHariIni()
    loadStatistikKehadiran()
  }, [
    academicPeriodPayload,
    loadJadwalHariIni,
    loadRingkasDanStatus,
    loadStatistikKehadiran,
    mapel,
    profile?.kelas,
    profile?.nama,
    pushToast,
    setStatus,
    statusRef,
    tgl,
    userId,
  ])

  const ajukanIzin = useCallback(async () => {
    if (!profile?.kelas || !userId || !mapel) {
      pushToast('error', 'Data tidak lengkap')
      return
    }

    if (!izinAvailability.allowed) {
      pushToast('error', izinAvailability.reason)
      return
    }

    try {
      setIsSubmitting(true)
      const useApiV2 = import.meta.env.VITE_USE_ATTENDANCE_API_V2 === 'true'

      const payload = {
        kelas: profile.kelas,
        tanggal: tgl,
        mapel,
        alasan: izinReason || 'Izin (Tanpa Keterangan)',
        ...academicPeriodPayload,
        idempotency_key: crypto.randomUUID()
      }

      if (useApiV2) {
        await attendanceService.storeAttendanceRequest(payload)
      } else {
        const res = await apiClient('/api/v2/attendance-requests', { method: 'POST', body: JSON.stringify({
          kelas: profile.kelas,
          tanggal: tgl,
          uid: userId,
          nama: profile.nama,
          alasan: izinReason || 'Izin (Tanpa Keterangan)',
          mapel,
          ...academicPeriodPayload
        }) })
        const error = null
        if (error) throw error
      }

      pushToast(
        'success',
        'Izin berhasil diajukan, menunggu persetujuan guru'
      )
      setIsIzinModalOpen(false)
      setIzinReason('')
    } catch (err) {
      console.error('Error ajukan izin:', err)
      pushToast('error', 'Gagal mengajukan izin')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    academicPeriodPayload,
    izinAvailability.allowed,
    izinAvailability.reason,
    izinReason,
    mapel,
    profile?.kelas,
    profile?.nama,
    pushToast,
    setIsSubmitting,
    tgl,
    userId,
  ])

  const submit = useCallback(async (st) => {
    if (!profile?.kelas || !userId) return
    if (!mapel) {
      pushToast('error', 'Pilih mapel terlebih dahulu')
      return
    }

    if (!isManualAbsenAllowed()) {
      pushToast('error', 'Absen mandiri ditutup oleh guru. Silakan ajukan izin bila diperlukan.')
      return
    }

    try {
      setIsSubmitting(true)

      if (tgl !== getToday()) {
        if (st === 'Izin') await ajukanIzin()
        else {
          pushToast(
            'error',
            'Untuk tanggal selain hari ini, hanya bisa mengajukan izin'
          )
        }
        return
      }

      if (!currentJadwal?.allow_self_absen) {
        pushToast(
          'error',
          'Absen mandiri belum diizinkan guru. Anda masih bisa mengajukan izin.'
        )
        return
      }

      const startMinutes = toMinutes(currentJadwal.jam_mulai)
      const endMinutes = toMinutes(currentJadwal.jam_selesai)
      const isWithinClassTime = currentMinutes >= startMinutes && currentMinutes <= endMinutes

      if (!isWithinClassTime && st !== 'Alpha') {
        pushToast(
          'error',
          'Sesi absensi sudah ditutup. Silakan hubungi guru.'
        )
        return
      }

      if (!isWithinClassTime && currentMinutes > endMinutes) {
        pushToast(
          'error',
          'Sesi absensi sudah ditutup. Silakan hubungi guru.'
        )
        return
      }

      await saveAbsensi(st, `Absen mandiri (${st})`)
    } catch (err) {
      console.error('Error submit absensi siswa:', err)
      pushToast('error', err?.code === 'ATTENDANCE_SELF_SERVICE_UNAVAILABLE'
        ? err.message
        : 'Gagal menyimpan absensi')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    ajukanIzin,
    currentJadwal,
    currentMinutes,
    isManualAbsenAllowed,
    mapel,
    profile?.kelas,
    pushToast,
    saveAbsensi,
    setIsSubmitting,
    tgl,
    userId,
  ])

  const handleQrScanToken = useCallback(
    async (rawToken) => {
      const token = extractQrToken(rawToken)
      if (!token) {
        const message = 'QR tidak berisi token absensi yang valid.'
        setQrScanError(message)
        pushToast('error', message)
        return false
      }

      if (isQrSubmitting) return false

      setIsQrSubmitting(true)
      setQrScanError('')

      try {
        const { data, error, raw } = await supabase.attendanceQr.scan(token)
        if (error) {
          const message = raw?.error || error?.message || 'Gagal memproses QR absensi'
          setQrScanError(message)
          pushToast('error', message, { duration: 5000 })
          return false
        }

        const result = data || {}
        setQrSuccessData(result)
        setStatus('Hadir')
        statusRef.current = 'Hadir'
        if (result.tanggal_iso) setTgl(result.tanggal_iso)
        if (result.mapel) setMapel(result.mapel)

        const jadwalList = jadwalRef.current || []
        const matchedIndex = jadwalList.findIndex((j) => j.mapel === result.mapel)
        if (matchedIndex !== -1) {
          setCurrentJadwalIndex(matchedIndex)
          setCurrentJadwal(jadwalList[matchedIndex])
        }

        pushToast('success', `Absensi QR berhasil untuk ${result.mapel || 'jadwal ini'}`, {
          duration: 4500
        })

        const {
          loadRingkasDanStatus: refreshRingkas,
          loadJadwalHariIni: refreshJadwal,
          loadStatistikKehadiran: refreshStatistik
        } = refreshFnsRef.current

        if (refreshRingkas) refreshRingkas()
        if (refreshJadwal) refreshJadwal()
        if (refreshStatistik) refreshStatistik()

        return true
      } catch (err) {
        const message = err?.message || 'Terjadi kesalahan saat memproses QR absensi'
        setQrScanError(message)
        pushToast('error', message)
        return false
      } finally {
        setIsQrSubmitting(false)
      }
    },
    [
      isQrSubmitting,
      jadwalRef,
      pushToast,
      refreshFnsRef,
      setCurrentJadwal,
      setCurrentJadwalIndex,
      setMapel,
      setStatus,
      setTgl,
      statusRef,
    ]
  )

  return {
    ajukanIzin,
    handleQrScanToken,
    isIzinModalOpen,
    isManualAbsenAllowed,
    isQrSubmitting,
    isSubmitting,
    izinReason,
    qrScanError,
    qrSuccessData,
    setIsIzinModalOpen,
    setIzinReason,
    setQrSuccessData,
    submit,
  }
}
