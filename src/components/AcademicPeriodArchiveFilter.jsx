import React from 'react'

const normalizeSemesterOptions = (options = []) => (
  options.map((option) => (
    typeof option === 'string'
      ? { value: option, label: option }
      : option
  )).filter((option) => option?.value)
)

const normalizeYearOptions = (options = []) => (
  options.map((option) => (
    typeof option === 'string'
      ? { value: option, label: option }
      : option
  )).filter((option) => option?.value)
)

export default function AcademicPeriodArchiveFilter({
  activeAcademicPeriod,
  periodFilter,
  academicYearOptions = [],
  semesterOptions = [],
  setAcademicYear,
  setSemester,
  resetToActivePeriod,
  title = 'Periode Data',
  className = '',
  compact = false,
  disabled = false
}) {
  const selectedYear = periodFilter?.tahunAjaran || activeAcademicPeriod?.tahunAjaran || ''
  const selectedSemester = periodFilter?.semester || activeAcademicPeriod?.semester || ''
  const isArchive =
    selectedYear !== (activeAcademicPeriod?.tahunAjaran || '') ||
    selectedSemester !== (activeAcademicPeriod?.semester || '')
  const normalizedYearOptions = normalizeYearOptions(academicYearOptions)
  const normalizedSemesterOptions = normalizeSemesterOptions(semesterOptions)

  return (
    <div className={`rounded-2xl border ${isArchive ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'} ${compact ? 'p-3' : 'p-4'} ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</div>
          <div className="mt-0.5 text-sm font-semibold text-slate-900">
            {selectedYear || '-'}{selectedSemester ? ` - Semester ${selectedSemester}` : ''}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${isArchive ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
          {isArchive ? 'Arsip' : 'Aktif'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_auto]">
        <select
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
          value={selectedYear}
          onChange={(event) => setAcademicYear?.(event.target.value)}
          disabled={disabled}
        >
          {normalizedYearOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}{option.isCurrent ? ' (kalender)' : ''}
            </option>
          ))}
        </select>

        <select
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
          value={selectedSemester}
          onChange={(event) => setSemester?.(event.target.value)}
          disabled={disabled}
        >
          {normalizedSemesterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={resetToActivePeriod}
          disabled={disabled || !isArchive}
        >
          Periode Aktif
        </button>
      </div>
    </div>
  )
}
