import React, { memo, useCallback } from 'react'
import ProfileAvatar from '../../../components/ProfileAvatar'
import { Badge, Button } from '../../../pages/admin/siswa/SiswaUi'
import { formatPresenceText, isPresenceOnline, presenceBadgeClassName } from '../../../utils/presence'
import { getProfileSourceMeta } from '../../../utils/profileSource'

function StudentTableRow({
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
  onMutasi,
}) {
  const photo = student.photo_path || student.photo_url || student.foto_url || student.foto || ''
  const status = student.status || 'active'
  const sourceMeta = getProfileSourceMeta(student.created_via)
  const canMutasi = !['mutasi', 'alumni'].includes(String(status).toLowerCase())
  const online = isPresenceOnline(student.online) || Number(student.active_devices || 0) > 0

  const handleDetail = useCallback(() => onDetail(student), [onDetail, student])
  const handleDeactivate = useCallback(() => onDeactivate(student), [onDeactivate, student])
  const handleActivate = useCallback(() => onActivate(student), [onActivate, student])
  const handleMutasi = useCallback(() => onMutasi(student), [onMutasi, student])

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-center">{rowNumber}</td>

      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center">
          <div className="flex-shrink-0 h-10 w-10">
            <ProfileAvatar
              src={photo}
              name={student.nama}
              size={40}
              className="border-gray-200"
              fallbackClassName="rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-sm font-medium text-blue-600"
            />
          </div>
          <div className="ml-3">
            <div className="text-sm font-medium text-gray-900">
              {student.nama || '-'}
              {isKetua && (
                <Badge variant="warning" className="ml-2 text-xs">Ketua</Badge>
              )}
            </div>
            <div className="text-sm text-gray-500">{student.email || '-'}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant={sourceMeta.variant} className="text-[11px]">{sourceMeta.label}</Badge>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${presenceBadgeClassName(student)}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                {formatPresenceText(student)}
              </span>
            </div>
          </div>
        </div>
      </td>

      <td className="px-4 py-3 text-sm text-gray-900">{kelasName}</td>
      <td className="px-4 py-3 text-sm text-gray-900">{student.nis || '-'}</td>
      <td className="px-4 py-3 text-sm text-gray-900">{genderLabel}</td>

      <td className="px-4 py-3 text-sm">
        {student.rfid_uid ? (
          <Badge variant="info" className="text-xs">{(student.rfid_uid || '').toUpperCase()}</Badge>
        ) : (
          <span className="text-gray-400">-</span>
        )}
      </td>

      <td className="px-4 py-3 whitespace-nowrap">
        <Badge variant={statusMeta.variant} className="text-xs">
          {statusMeta.icon} {statusMeta.label}
        </Badge>
      </td>

      <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium space-x-1">
        <Button variant="primary" size="sm" onClick={handleDetail}>Detail</Button>

        {canManage && (
          <>
            {status === 'active' ? (
              <Button variant="warning" size="sm" onClick={handleDeactivate}>Nonaktif</Button>
            ) : (
              <Button variant="success" size="sm" onClick={handleActivate}>Aktifkan</Button>
            )}

            {canMutasi && (
              <Button variant="warning" size="sm" onClick={handleMutasi}>Mutasi</Button>
            )}
          </>
        )}
      </td>
    </tr>
  )
}

export default memo(StudentTableRow)
