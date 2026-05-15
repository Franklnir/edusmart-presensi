import { useEffect } from 'react'
import { supabase } from '../../../lib/supabase'

export function useStudentAttendanceRealtime({
  loadJadwalHariIni,
  loadRingkasDanStatus,
  loadStatistikKehadiran,
  mapel,
  profile,
  tgl,
  userId,
}) {
  useEffect(() => {
    if (!profile?.kelas || !userId) return

    const channels = []

    const absensiChannel = supabase
      .channel(`absensi-realtime-siswa-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absensi',
          filter: `uid=eq.${userId}`
        },
        () => {
          loadRingkasDanStatus()
          loadJadwalHariIni()
          loadStatistikKehadiran()
        }
      )
      .subscribe()
    channels.push(absensiChannel)

    const ajuanChannel = supabase
      .channel(`ajuan-realtime-siswa-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absensi_ajuan',
          filter: `uid=eq.${userId}`
        },
        () => {
          loadJadwalHariIni()
        }
      )
      .subscribe()
    channels.push(ajuanChannel)

    const settingsChannel = supabase
      .channel(`absensi-settings-${profile.kelas}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absensi_settings',
          filter: `kelas=eq.${profile.kelas}`
        },
        () => {
          loadJadwalHariIni()
        }
      )
      .subscribe()
    channels.push(settingsChannel)

    const ringkasanChannel = supabase
      .channel(`absensi-ringkasan-${profile.kelas}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absensi',
          filter: `kelas=eq.${profile.kelas}`
        },
        (payload) => {
          const row = payload.new || payload.old
          if (row && row.mapel === mapel && row.tanggal === tgl) {
            loadRingkasDanStatus()
          }
        }
      )
      .subscribe()
    channels.push(ringkasanChannel)

    return () => {
      channels.forEach((channel) => {
        supabase.removeChannel(channel)
      })
    }
  }, [
    loadJadwalHariIni,
    loadRingkasDanStatus,
    loadStatistikKehadiran,
    mapel,
    profile?.kelas,
    tgl,
    userId,
  ])
}
