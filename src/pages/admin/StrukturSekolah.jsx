import React, { useCallback, useEffect, useState } from 'react'
import { Building2, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useUIStore } from '../../store/useUIStore'
import StrukturSekolahTab from './kelas/StrukturSekolahTab'

export default function StrukturSekolahPage() {
  const { pushToast } = useUIStore()
  const [guruList, setGuruList] = useState([])
  const [loading, setLoading] = useState(true)

  const loadGuru = useCallback(async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('profiles')
        .select('id,nama,email,jabatan,status,role')
        .in('role', ['guru', 'teacher'])
        .order('nama')

      if (error) throw error
      setGuruList((data || []).map((guru) => {
        const name = guru.nama || guru.email || guru.id
        return {
          ...guru,
          name,
          label: `${name}${guru.email ? ` (${guru.email})` : ''}`
        }
      }))
    } catch (error) {
      pushToast('error', error?.message || 'Gagal memuat data guru')
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useEffect(() => {
    loadGuru()
  }, [loadGuru])

  return (
    <div className="w-full space-y-6 px-4 pb-8 pt-2 sm:px-6 lg:px-8">
      <div className="page-title-card">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="page-title-heading">Struktur Sekolah</h1>
            <p className="page-title-description">
              Kelola jabatan, penanggung jawab, dan wali kelas dalam satu halaman.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            Memuat struktur sekolah...
          </div>
        </div>
      ) : (
        <StrukturSekolahTab
          guruList={guruList}
          pushToast={pushToast}
          showHeader={false}
        />
      )}
    </div>
  )
}
