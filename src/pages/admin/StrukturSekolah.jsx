import React from 'react'
import { Building2 } from 'lucide-react'
import { useUIStore } from '../../store/useUIStore'
import useActiveAcademicPeriod from '../../hooks/useActiveAcademicPeriod'
import AcademicPeriodArchiveFilter from '../../components/AcademicPeriodArchiveFilter'
import StrukturSekolahTab from './kelas/StrukturSekolahTab'

export default function StrukturSekolahPage() {
  const { pushToast } = useUIStore()
  const {
    activeAcademicPeriod,
    activeSemesterPeriod: academicPeriod,
    periodFilter,
    academicYearOptions,
    setAcademicYear,
    isViewingArchivePeriod
  } = useActiveAcademicPeriod({ storageKey: 'edusmart.admin.strukturSekolah.periodFilter' })
  const periodLabel = academicPeriod?.tahunAjaran ? `Tahun ajaran ${academicPeriod.tahunAjaran}` : 'Tahun ajaran aktif'

  return (
    <div className="w-full space-y-6 px-4 pb-8 pt-2 sm:px-6 lg:px-8">
      <div className="page-title-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="page-title-heading">Struktur Sekolah</h1>
              <p className="page-title-description">
                Kelola jabatan, penanggung jawab, dan wali kelas untuk {periodLabel}.
              </p>
              {isViewingArchivePeriod && (
                <p className="mt-1 text-xs font-semibold text-amber-700">
                  Mode riwayat hanya bisa dilihat. Ubah periode aktif sekolah jika ingin mengedit periode ini.
                </p>
              )}
            </div>
          </div>
          <AcademicPeriodArchiveFilter
            activeAcademicPeriod={activeAcademicPeriod}
            periodFilter={periodFilter}
            academicYearOptions={academicYearOptions}
            setAcademicYear={setAcademicYear}
            title="Periode Struktur"
            compact
          />
        </div>
      </div>

      <StrukturSekolahTab
        guruList={[]}
        academicPeriod={academicPeriod}
        activeAcademicPeriod={activeAcademicPeriod}
        academicYearOptions={academicYearOptions}
        pushToast={pushToast}
        showHeader={false}
        readOnly={isViewingArchivePeriod}
      />
    </div>
  )
}
