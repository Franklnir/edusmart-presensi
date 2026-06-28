import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useUIStore } from '../../store/useUIStore'
import useActiveAcademicPeriod from '../../hooks/useActiveAcademicPeriod'
import OrganisasiTab from './kelas/OrganisasiTab'

export default function OrganisasiPage() {
  const { pushToast } = useUIStore()
  const { activeSemesterPeriod: academicPeriod } = useActiveAcademicPeriod({ persistFilter: false })
  const [guruList, setGuruList] = useState([])

  const loadPeople = useCallback(async () => {
    try {
      const guruResult = await supabase
        .from('profiles')
        .select('id,nama,email,jabatan,status')
        .eq('role', 'guru')
        .order('nama')

      if (guruResult.error) throw guruResult.error

      setGuruList((guruResult.data || []).map((guru) => ({
        ...guru,
        name: guru.nama || guru.email || guru.id
      })))
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memuat data organisasi')
    }
  }, [pushToast])

  useEffect(() => {
    loadPeople()
  }, [loadPeople])

  return (
    <div className="w-full space-y-6 px-4 pb-8 pt-2 sm:px-6 lg:px-8">
      <div className="page-title-card">
        <div className="flex items-center space-x-4">
          <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700">
            <span className="text-2xl">👥</span>
          </div>
          <div>
            <h1 className="page-title-heading">Organisasi Sekolah</h1>
            <p className="page-title-description">
              Kelola organisasi, pembina, jabatan, dan anggota siswa untuk tahun ajaran {academicPeriod?.tahunAjaran || 'aktif'}.
            </p>
          </div>
        </div>
      </div>

      <OrganisasiTab
        guruList={guruList}
        siswaList={[]}
        academicPeriod={academicPeriod}
        pushToast={pushToast}
        showHeader={false}
      />
    </div>
  )
}
