import { apiClient } from '../lib/api/client'

export async function fetchStudentClassHistory({
  studentId,
  tahunAjaran,
  semester = '',
  signal,
}) {
  if (!studentId || !tahunAjaran) return null

  try {
    const params = { tahun_ajaran: tahunAjaran }
    if (semester) params.semester = semester

    const { data } = await apiClient.get(
      `/api/v2/students/${studentId}/class-history`,
      { params, signal }
    )

    if (data?.success && data?.data) {
      return data.data.latest_class_id || null
    }

    return null
  } catch (err) {
    if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') throw err
    console.warn('Gagal memuat kelas siswa sesuai periode:', err)
    return null
  }
}

export async function fetchClassRosterHistory({
  classId,
  tahunAjaran,
  semester = '',
  status = '',
  signal,
}) {
  if (!classId || !tahunAjaran) return []

  try {
    const params = { tahun_ajaran: tahunAjaran }
    if (semester) params.semester = semester
    if (status) params.status = status

    const { data } = await apiClient.get(
      `/api/v2/classes/${classId}/roster-history`,
      { params, signal }
    )

    if (data?.success && data?.data?.student_ids) {
      return data.data.student_ids
    }

    return []
  } catch (err) {
    if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') throw err
    console.warn('Gagal memuat roster historis kelas:', err)
    return []
  }
}

export default fetchStudentClassHistory
