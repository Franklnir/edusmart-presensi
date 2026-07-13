import { normalizeSemester } from './academicPeriod'

export const ASSESSMENT_SLOT_REGULAR = 'regular'
export const ASSESSMENT_SLOT_MIDTERM = 'uts'
export const ASSESSMENT_SLOT_FINAL = 'uas'

export const normalizeAssessmentSlot = (value, { isLive = false } = {}) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === ASSESSMENT_SLOT_REGULAR) return ASSESSMENT_SLOT_REGULAR
  if (['uts', 'pts', 'midterm', 'ulangan'].includes(raw)) return ASSESSMENT_SLOT_MIDTERM
  if (['uas', 'pas', 'ukk', 'pat', 'final'].includes(raw)) return ASSESSMENT_SLOT_FINAL
  return isLive ? ASSESSMENT_SLOT_MIDTERM : ASSESSMENT_SLOT_REGULAR
}

export const getAcademicAssessmentLabels = (semester) => {
  const normalizedSemester = normalizeSemester(semester) || 'Ganjil'
  const isEvenTerm = normalizedSemester === 'Genap'

  return {
    semester: normalizedSemester,
    midterm: {
      slot: ASSESSMENT_SLOT_MIDTERM,
      short: 'UTS',
      formal: 'UTS / PTS',
      description: `Ujian tengah Semester ${normalizedSemester}`
    },
    final: {
      slot: ASSESSMENT_SLOT_FINAL,
      short: isEvenTerm ? 'UKK' : 'UAS',
      formal: isEvenTerm ? 'UKK / PAT' : 'UAS / PAS',
      description: isEvenTerm
        ? 'Ujian kenaikan kelas / penilaian akhir tahun'
        : 'Ujian akhir / penilaian akhir semester'
    }
  }
}

export const getAssessmentSlotLabel = (slot, semester, { formal = false } = {}) => {
  const normalizedSlot = normalizeAssessmentSlot(slot)
  if (normalizedSlot === ASSESSMENT_SLOT_REGULAR) return 'Reguler'

  const labels = getAcademicAssessmentLabels(semester)
  const assessment = normalizedSlot === ASSESSMENT_SLOT_FINAL
    ? labels.final
    : labels.midterm

  return formal ? assessment.formal : assessment.short
}
