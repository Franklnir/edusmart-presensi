import React, { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryClient'
import { useUIStore } from '../../store/useUIStore'
import useActiveAcademicPeriod from '../../hooks/useActiveAcademicPeriod'
import AcademicPeriodArchiveFilter from '../../components/AcademicPeriodArchiveFilter'
import OrganisasiTab from './kelas/OrganisasiTab'

export default function OrganisasiPage() {
  const { pushToast } = useUIStore()
  const {
    activeAcademicPeriod,
    activeSemesterPeriod: academicPeriod,
    periodFilter,
    academicYearOptions,
    setAcademicYear,
    isViewingArchivePeriod
  } = useActiveAcademicPeriod({ storageKey: 'edusmart.admin.organisasi.periodFilter' })
  const {
    data: guruList = [],
    error: guruError,
    isFetching: guruFetching
  } = useQuery({
    queryKey: queryKeys.admin.teacherOptions({ scope: 'organisasi' }),
    queryFn: async () => {
      const guruResult = await supabase
        .from('profiles')
        .select('id,nama,email,jabatan,status')
        .eq('role', 'guru')
        .order('nama')

      if (guruResult.error) throw guruResult.error

      return (guruResult.data || []).map((guru) => ({
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center space-x-4">
            <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700">
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
