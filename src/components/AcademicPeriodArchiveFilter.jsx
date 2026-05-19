import React, { useEffect, useId, useMemo, useState } from 'react'
import { CalendarDays, X } from 'lucide-react'

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
  title = 'Periode Data',
  className = '',
  compact = false,
  disabled = false
}) {
  const selectedYear = periodFilter?.tahunAjaran || activeAcademicPeriod?.tahunAjaran || ''
  const selectedSemester = periodFilter?.semester || activeAcademicPeriod?.semester || ''
  const generatedId = useId().replace(/:/g, '')
  const periodButtonId = `academic-period-button-${generatedId}`
  const dialogTitleId = `academic-period-filter-title-${generatedId}`
  const academicYearSelectId = `academic-period-year-${generatedId}`
  const isArchive =
    selectedYear !== (activeAcademicPeriod?.tahunAjaran || '') ||
    selectedSemester !== (activeAcademicPeriod?.semester || '')
  const normalizedYearOptions = useMemo(
    () => normalizeYearOptions(academicYearOptions),
    [academicYearOptions]
  )
  const normalizedSemesterOptions = useMemo(
    () => normalizeSemesterOptions(semesterOptions),
    [semesterOptions]
  )
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState({
    tahunAjaran: selectedYear,
    semester: selectedSemester
  })
  const draftIsArchive =
    draft.tahunAjaran !== (activeAcademicPeriod?.tahunAjaran || '') ||
    draft.semester !== (activeAcademicPeriod?.semester || '')

  useEffect(() => {
    if (!isOpen) return
    setDraft({
      tahunAjaran: selectedYear,
      semester: selectedSemester
    })
  }, [isOpen, selectedSemester, selectedYear])

  useEffect(() => {
    if (!isOpen) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const handleOpen = () => {
    if (disabled) return
    setDraft({
      tahunAjaran: selectedYear,
      semester: selectedSemester
    })
    setIsOpen(true)
  }

  const handleUseActivePeriod = () => {
    setDraft({
      tahunAjaran: activeAcademicPeriod?.tahunAjaran || selectedYear,
      semester: activeAcademicPeriod?.semester || selectedSemester
    })
  }

  const handleApply = () => {
    if (draft.tahunAjaran !== selectedYear) setAcademicYear?.(draft.tahunAjaran)
    if (draft.semester !== selectedSemester) setSemester?.(draft.semester)
    setIsOpen(false)
  }

  return (
    <>
      <div className={className}>
        <div className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
          {title}
        </div>
        <button
          id={periodButtonId}
          type="button"
          onClick={handleOpen}
          disabled={disabled}
          className={`w-full rounded-2xl border border-slate-300 bg-white text-left shadow-sm transition-all hover:border-indigo-300 hover:bg-indigo-50/50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 ${
            compact ? 'px-3 py-2.5' : 'px-4 py-3'
          }`}
          aria-label={`Buka pengaturan ${title.toLowerCase()}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-900">
                {selectedYear || '-'}{selectedSemester ? ` - Semester ${selectedSemester}` : ''}
              </div>
              <div className="mt-0.5 text-[11px] font-medium text-slate-500">
                {isArchive ? 'Periode arsip dipilih' : 'Mengikuti periode aktif sekolah'}
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                isArchive ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {isArchive ? 'Arsip' : 'Aktif'}
            </span>
          </div>
        </button>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            onClick={() => setIsOpen(false)}
            aria-label={`Tutup pengaturan ${title.toLowerCase()}`}
          />

          <div
            className="relative w-full max-h-[92vh] overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div>
                  <h3 id={dialogTitleId} className="text-base font-extrabold text-slate-900">
                    {title}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Pilih tahun ajaran dan semester untuk memuat data pada halaman ini.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-label="Tutup pengaturan periode"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(92vh-145px)] overflow-y-auto px-5 py-5">
              <div className="space-y-5">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                        Periode Aktif Sekolah
                      </div>
                      <div className="mt-1 text-sm font-extrabold text-slate-900">
                        {activeAcademicPeriod?.tahunAjaran || '-'}{activeAcademicPeriod?.semester ? ` - Semester ${activeAcademicPeriod.semester}` : ''}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-600">
                        {activeAcademicPeriod?.rangeLabel || 'Mengikuti pengaturan akademik sekolah.'}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                      Aktif
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor={academicYearSelectId} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                      Tahun Ajaran
                    </label>
                    <select
                      id={academicYearSelectId}
                      name="tahun_ajaran"
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                      value={draft.tahunAjaran}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        tahunAjaran: event.target.value
                      }))}
                    >
                      {normalizedYearOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}{option.isCurrent ? ' (kalender)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                      Semester
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {normalizedSemesterOptions.map((option) => {
                        const selected = draft.semester === option.value
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setDraft((current) => ({
                              ...current,
                              semester: option.value
                            }))}
                            className={`min-h-[46px] rounded-2xl border px-3 text-sm font-bold transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                              selected
                                ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm'
                                : 'border-slate-300 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50'
                            }`}
                            aria-pressed={selected}
                          >
                            {option.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleUseActivePeriod}
                  disabled={!draftIsArchive}
                  className="w-full rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-700 transition-all hover:bg-indigo-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  Gunakan Periode Aktif
                </button>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-2xl px-5 py-3 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                Terapkan Periode
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
