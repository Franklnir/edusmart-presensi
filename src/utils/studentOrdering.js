const collator = new Intl.Collator('id', {
  numeric: true,
  sensitivity: 'base',
})

const ATTENDANCE_NUMBER_FIELDS = [
  'no_absen',
  'nomor_absen',
  'nomorAbsen',
  'absen',
  'attendanceNumber',
]

function getStudentClassSortKey(student = {}) {
  return String(student?.kelas || student?.kelas_id || student?.class_id || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

export function getStudentAttendanceNumber(student = {}) {
  for (const field of ATTENDANCE_NUMBER_FIELDS) {
    const value = student?.[field]
    if (value === null || value === undefined || value === '') continue
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) return number
  }

  return null
}

export function compareStudentsByAttendanceOrder(a = {}, b = {}) {
  const aClass = getStudentClassSortKey(a)
  const bClass = getStudentClassSortKey(b)
  const classCompare = collator.compare(aClass, bClass)
  if (classCompare !== 0) return classCompare

  const aNo = getStudentAttendanceNumber(a)
  const bNo = getStudentAttendanceNumber(b)
  if (aNo !== null && bNo !== null && aNo !== bNo) return aNo - bNo
  if (aNo !== null && bNo === null) return -1
  if (aNo === null && bNo !== null) return 1

  const nameCompare = collator.compare(String(a?.nama || ''), String(b?.nama || ''))
  if (nameCompare !== 0) return nameCompare

  const nisCompare = collator.compare(String(a?.nis || ''), String(b?.nis || ''))
  if (nisCompare !== 0) return nisCompare

  return collator.compare(String(a?.id || a?.uid || ''), String(b?.id || b?.uid || ''))
}

export function sortStudentsByAttendanceOrder(students = []) {
  return [...(students || [])].sort(compareStudentsByAttendanceOrder)
}
