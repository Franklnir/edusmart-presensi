import React, { memo } from 'react'
import ProfileAvatar from '../../../components/ProfileAvatar'
import { Badge, Button, Card } from '../../../pages/admin/siswa/SiswaUi'
import StudentTableRow from '../components/StudentTableRow'
import StudentPagination from '../components/StudentPagination'
import { JK_LABEL, STATUS_META } from '../utils/studentFormatters'

const StudentRowSkeleton = () => (
  <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-4">
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 rounded-full bg-gray-200" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-4 w-2/3 rounded bg-gray-200" />
        <div className="h-3 w-1/2 rounded bg-gray-200" />
      </div>
      <div className="h-8 w-16 rounded-lg bg-gray-200" />
    </div>
  </div>
)

const StudentMobileCard = ({
  student,
  rowNumber,
  canManage,
  isKetua,
  kelasName,
  genderLabel,
  statusMeta,
  onDetail,
  onDeactivate,
  onActivate,
  onMutasi
}) => {
  const status = student.status || 'active'
  const canMutasi = !['mutasi', 'alumni'].includes(String(status).toLowerCase())
  const photo = student.photo_path || student.photo_url || student.foto_url || student.foto || ''

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <ProfileAvatar src={photo} name={student.nama} size={42} className="border-gray-200" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-900">
                {rowNumber}. {student.nama || '-'}
              </div>
              <div className="truncate text-xs text-gray-500">{student.email || '-'}</div>
            </div>
            <Badge variant={statusMeta.variant} className="shrink-0 text-[11px]">
              {statusMeta.label}
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
            <div>
              <span className="block text-gray-400">Kelas</span>
              <span className="font-medium text-gray-800">{kelasName}</span>
            </div>
            <div>
              <span className="block text-gray-400">NIS</span>
              <span className="font-medium text-gray-800">{student.nis || '-'}</span>
            </div>
            <div>
              <span className="block text-gray-400">JK</span>
              <span className="font-medium text-gray-800">{genderLabel}</span>
            </div>
            <div>
              <span className="block text-gray-400">RFID</span>
              <span className="font-medium text-gray-800">{student.rfid_uid ? student.rfid_uid.toUpperCase() : '-'}</span>
            </div>
          </div>

          {isKetua && (
            <Badge variant="warning" className="mt-3 text-[11px]">Ketua kelas</Badge>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={() => onDetail(student)}>Detail</Button>
            {canManage && (
              <>
                {status === 'active' ? (
                  <Button variant="warning" size="sm" onClick={() => onDeactivate(student)}>Nonaktif</Button>
                ) : (
                  <Button variant="success" size="sm" onClick={() => onActivate(student)}>Aktifkan</Button>
                )}
                {canMutasi && (
                  <Button variant="warning" size="sm" onClick={() => onMutasi(student)}>Mutasi</Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StudentTableSection({
  loadingInit,
  loadingRows,
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
  const isTableLoading = loadingInit || loadingRows

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

      <div className="relative">
        {loadingRows && !loadingInit && (
          <div className="absolute left-0 right-0 top-0 z-10 h-1 overflow-hidden bg-indigo-50">
            <div className="h-full w-1/3 animate-pulse rounded-r-full bg-indigo-500" />
          </div>
        )}

        {isTableLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <StudentRowSkeleton key={i} />
            ))}
          </div>
        ) : (
          <>
            <div className="space-y-3 p-4 md:hidden">
              {paginatedSiswa.map((s, index) => (
                <StudentMobileCard
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
            </div>

            <div className="hidden overflow-x-auto md:block">
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
                </tbody>
              </table>
            </div>

            {!siswa.length && (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-gray-100" />
                <p className="text-gray-500 font-medium mb-1">Tidak ada data siswa</p>
                <p className="text-gray-400 text-sm">Coba ubah filter pencarian</p>
              </div>
            )}
          </>
        )}
      </div>
      {!loadingInit && <StudentPagination pagination={pagination} />}
    </Card>
  )
}

export default memo(StudentTableSection)
