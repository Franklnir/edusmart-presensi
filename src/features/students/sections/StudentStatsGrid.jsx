import React, { memo } from 'react'
import { StatCard } from '../../../pages/admin/siswa/SiswaUi'

function StudentStatsGrid({ stats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        label="Total Siswa"
        value={stats.totalSiswa}
        icon="👨‍🎓"
        color="blue"
        description="Semua siswa terdaftar"
      />
      <StatCard
        label="Siswa Aktif"
        value={stats.aktifSiswa}
        icon="✅"
        color="green"
        description="Sedang aktif belajar"
      />
      <StatCard
        label="Siswa Nonaktif"
        value={stats.nonaktifSiswa}
        icon="⏸️"
        color="orange"
        description={`Nonaktif: ${stats.nonaktifOnly} • Mutasi: ${stats.mutasiSiswa} • Alumni: ${stats.alumniSiswa}`}
      />
      <StatCard
        label="Ketua Kelas"
        value={stats.ketuaKelas}
        icon="👑"
        color="indigo"
        description="Siswa yang menjadi ketua"
      />
    </div>
  )
}

export default memo(StudentStatsGrid)
