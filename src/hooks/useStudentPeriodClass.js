import { useEffect, useMemo, useState } from 'react'
import { fetchStudentClassHistory } from '../services/studentClassHistoryService'

const getFallbackClass = (profile) => (
  String(profile?.kelas || profile?.kelas_id || '').trim()
)

export async function fetchStudentPeriodClass({
  userId,
  profile,
  tahunAjaran,
  semester = '',
  activeTahunAjaran = ''
}) {
  const fallbackClass = getFallbackClass(profile)
  const studentId = String(userId || profile?.id || '').trim()
  const year = String(tahunAjaran || '').trim()

  if (!studentId || !year) return fallbackClass

  try {
    const resolvedClass = await fetchStudentClassHistory({
      studentId,
      tahunAjaran: year,
      semester
    })

    if (resolvedClass) return resolvedClass

    return year === String(activeTahunAjaran || '').trim() ? fallbackClass : ''
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn('Gagal memuat kelas siswa sesuai periode:', error)
    }
    return year === String(activeTahunAjaran || '').trim() ? fallbackClass : ''
  }
}

export default function useStudentPeriodClass({
  userId,
  profile,
  tahunAjaran,
  semester = '',
  activeTahunAjaran = ''
}) {
  const fallbackClass = useMemo(() => getFallbackClass(profile), [profile])
  const [periodClass, setPeriodClass] = useState(fallbackClass)

  useEffect(() => {
    let cancelled = false

    const resolveClass = async () => {
      const studentId = String(userId || profile?.id || '').trim()
      const year = String(tahunAjaran || '').trim()

      if (!studentId || !year) {
        setPeriodClass(fallbackClass)
        return
      }

      try {
        const resolvedClass = await fetchStudentPeriodClass({
          userId: studentId,
          profile,
          tahunAjaran: year,
          semester,
          activeTahunAjaran
        })
        if (cancelled) return
        setPeriodClass(resolvedClass)
      } catch (error) {
        if (!cancelled) {
          console.warn('Gagal memuat kelas siswa sesuai periode:', error)
          setPeriodClass(year === String(activeTahunAjaran || '').trim() ? fallbackClass : '')
        }
      }
    }

    resolveClass()

    return () => {
      cancelled = true
    }
  }, [activeTahunAjaran, fallbackClass, profile, semester, tahunAjaran, userId])

  return periodClass
}
