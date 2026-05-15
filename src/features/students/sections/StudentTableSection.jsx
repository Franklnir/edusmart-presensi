import React, { memo } from 'react'
import { Card } from '../../../pages/admin/siswa/SiswaUi'
import StudentTableRow from '../components/StudentTableRow'
import StudentPagination from '../components/StudentPagination'
import { JK_LABEL, STATUS_META } from '../utils/studentFormatters'

function StudentTableSection({
  loadingInit,
  siswa,
  siswaRaw,
  totalCount,
  paginatedSiswa,
  pagination,
  canManage,
  isKetuaKelas,
  getNamaKelas,
  onDetail,
  onDeactivate,
  onActivate,
  onMutasi
}) {
  return (
    <Card>
      <div className="bg-gray-50 border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <span>📊</span>
            Daftar Siswa
          </h3>
          <span className="text-sm text-gray-600">
            {siswa.length} dari {totalCount ?? siswaRaw.length} siswa
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        {loadingInit ? (
          <div className="p-8 space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="animate-pulse flex space-x-4 items-center">
                <div className="rounded-full bg-gray-200 h-10 w-10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider border-b">No</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Siswa</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Kelas</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">NIS</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">JK</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">RFID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                  {canManage ? 'Aksi' : 'Detail'}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedSiswa.map((s, index) => (
                <StudentTableRow
                  key={s.id}
                  student={s}
                  rowNumber={pagination.startIndex + index + 1}
                  canManage={canManage}
                  isKetua={isKetuaKelas(s.id)}
                  kelasName={getNamaKelas(s.kelas)}
                  genderLabel={JK_LABEL(s.jk)}
                  statusMeta={STATUS_META(s.status || 'active')}
                  onDetail={onDetail}
                  onDeactivate={onDeactivate}
                  onActivate={onActivate}
                  onMutasi={onMutasi}
                />
              ))}

              {!siswa.length && (
                <tr>
                  <td colSpan="8" className="px-4 py-8 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <div className="text-gray-300 text-4xl mb-2">👨‍🎓</div>
                      <p className="text-gray-500 font-medium mb-1">Tidak ada data siswa</p>
                      <p className="text-gray-400 text-sm">Coba ubah filter pencarian</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {!loadingInit && <StudentPagination pagination={pagination} />}
    </Card>
  )
}

export default memo(StudentTableSection)
