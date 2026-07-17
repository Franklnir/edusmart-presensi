import React, { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { teacherService } from '../../services/teacherService'
import { queryKeys } from '../../lib/queryClient'
import { useUIStore } from '../../store/useUIStore'
import useActiveAcademicPeriod from '../../hooks/useActiveAcademicPeriod'
import AcademicPeriodArchiveFilter from '../../components/AcademicPeriodArchiveFilter'
import OrganisasiTab from './kelas/OrganisasiTab'

export default function OrganisasiPage() {
  const { pushToast } = useUIStore()
  const {
    activeAcademicPeriod,
    period: academicPeriod,
    periodFilter,
    academicYearOptions,
    setAcademicYear,
    isViewingArchivePeriod
  } = useActiveAcademicPeriod({
    storageKey: 'edusmart.admin.organisasi.periodFilter',
    scope: 'year'
  })
  const {
    data: guruList = [],
    error: guruError,
    isFetching: guruFetching
  } = useQuery({
    queryKey: queryKeys.admin.teacherOptions({ scope: 'organisasi' }),
    queryFn: async () => {
      const rows = await teacherService.getTeacherOptions({ per_page: 200 })
      return (rows || []).map((guru) => ({
        ...guru,
        name: guru.nama || guru.email || guru.id
      }))
    },
    placeholderData: (previousData) => previousData || [],
    staleTime: 5 * 60 * 1000
  })

  useEffect(() => {
    if (guruError) {
      pushToast('error', guruError?.message || 'Gagal memuat data guru organisasi')
    }
  }, [guruError, pushToast])

  return (
    <div className="w-full space-y-6 px-4 pb-8 pt-2 sm:px-6 lg:px-8">
      <div className="page-title-card">
        <div className="page-title-layout">
          <div className="page-title-main">
            <div className="page-title-icon bg-emerald-100 text-emerald-700">
              <span className="text-2xl">👥</span>
            </div>
            <div>
              <h1 className="page-title-heading">Organisasi Sekolah</h1>
              <p className="page-title-description">
                Kelola organisasi, pembina, jabatan, dan anggota siswa untuk tahun ajaran {academicPeriod?.tahunAjaran || 'aktif'}.
              </p>
              {guruFetching && (
                <p className="mt-1 text-xs font-semibold text-emerald-600">Memperbarui opsi guru...</p>
              )}
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
            title="Periode Organisasi"
            compact
          />
        </div>
      </div>

      <OrganisasiTab
        guruList={guruList}
        siswaList={[]}
        academicPeriod={academicPeriod}
        pushToast={pushToast}
        showHeader={false}
        readOnly={isViewingArchivePeriod}
      />
    </div>
  )
}
