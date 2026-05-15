import React, { memo } from 'react'
import { Badge, Button } from '../../../../pages/admin/siswa/SiswaUi'

function StudentOrganizationPanel({
  orgMember,
  osisRow,
  canManage,
  onDeleteOrg,
  onDeleteOsis
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span>-</span>
          Organisasi ({orgMember.length})
        </h4>
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {orgMember.map(row => (
            <div key={row.orgId} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-900">{row.orgNama}</p>
                <p className="text-xs text-gray-500">{row.jabatan} - {row.bagian || '-'}</p>
              </div>
              {canManage && (
                <Button variant="danger" size="sm" onClick={() => onDeleteOrg(row.orgId)}>Hapus</Button>
              )}
            </div>
          ))}
          {!orgMember.length && (
            <p className="text-gray-500 text-sm text-center py-4">Belum terdaftar di organisasi</p>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span>-</span>
          OSIS
        </h4>
        {osisRow ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-sm font-medium text-gray-700">Status</p>
                <Badge variant={osisRow.status === 'aktif' ? 'success' : 'danger'} className="text-xs">
                  {osisRow.status}
                </Badge>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">Jabatan</p>
                <p className="text-sm text-gray-900">{osisRow.jabatan}</p>
              </div>
            </div>
            {osisRow.bagian && (
              <div>
                <p className="text-sm font-medium text-gray-700">Bagian</p>
                <p className="text-sm text-gray-900">{osisRow.bagian}</p>
              </div>
            )}
            {canManage && (
              <div className="flex justify-end">
                <Button variant="danger" size="sm" onClick={onDeleteOsis}>Hapus</Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-gray-500 text-sm text-center py-4">Belum terdaftar di OSIS</p>
        )}
      </div>
    </div>
  )
}

export default memo(StudentOrganizationPanel)
