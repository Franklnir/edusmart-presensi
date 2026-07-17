import { useEffect } from 'react'
import echo from '../../../lib/echo'

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
    const key = `absensi.${profile.kelas}.${tgl || 'all'}.${mapel || 'all'}`
    const ch = echo.channel(key).listen('.absensi.updated', () => {
      loadRingkasDanStatus()
      loadJadwalHariIni()
      loadStatistikKehadiran()
    })
    return () => { echo.leaveChannel(key) }
  }, [loadJadwalHariIni, loadRingkasDanStatus, loadStatistikKehadiran, mapel, profile?.kelas, tgl, userId])
}
