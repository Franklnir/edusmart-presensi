import useActiveAcademicPeriod from '../../../hooks/useActiveAcademicPeriod'

const STORAGE_KEY = 'edusmart.attendance.periodFilter'

export function useAttendanceAcademicPeriod() {
  const {
    academicPeriodPayload,
    activeAcademicPeriod,
    academicYearOptions,
    isViewingArchivePeriod,
    periodFilter,
    resetToActivePeriod,
    semesterOptions,
    setAcademicYear,
    setPeriodFilter,
    setSemester,
    termPeriod
  } = useActiveAcademicPeriod({ storageKey: STORAGE_KEY })

  return {
    academicPeriodPayload,
    activeAcademicPeriod,
    academicYearOptions,
    isViewingArchivePeriod,
    periodFilter,
    resetToActivePeriod,
    semesterOptions,
    setAcademicYear,
    setPeriodFilter,
    setSemester,
    termPeriod
  }
}
