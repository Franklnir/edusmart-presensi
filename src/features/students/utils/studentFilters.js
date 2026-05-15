export function filterStudents(students = [], filters = {}) {
  const namaNeedle = String(filters.qNama || '').trim().toLowerCase()
  const nisNeedle = String(filters.qNIS || '').trim().toLowerCase()
  const kelasNeedle = String(filters.qKelas || '')
  const hasRfidNeedle = String(filters.qHasRfid || '')
  const statusNeedle = String(filters.qStatus || '')

  return (students || []).filter((student) => {
    const okNama = namaNeedle
      ? (
          String(student.nama || '').toLowerCase().includes(namaNeedle) ||
          String(student.email || '').toLowerCase().includes(namaNeedle)
        )
      : true

    const okNis = nisNeedle
      ? String(student.nis || '').toLowerCase().includes(nisNeedle)
      : true

    const okKelas = kelasNeedle
      ? String(student.kelas || '') === kelasNeedle
      : true

    const hasRfid = Boolean(student.rfid_uid)
    const okRfid =
      hasRfidNeedle === ''
        ? true
        : hasRfidNeedle === 'yes'
          ? hasRfid
          : !hasRfid

    const currentStatus = student.status || 'active'
    const okStatus = statusNeedle === ''
      ? true
      : currentStatus === statusNeedle

    return okNama && okNis && okKelas && okRfid && okStatus
  })
}
