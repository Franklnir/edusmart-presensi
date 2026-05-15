import React, { memo } from 'react'
import ProfileAvatar from '../../../components/ProfileAvatar'
import { Badge, Button } from '../../../pages/admin/siswa/SiswaUi'
import StudentAdditionalInfoPanel from '../components/detail/StudentAdditionalInfoPanel'
import StudentClassStatusPanel from '../components/detail/StudentClassStatusPanel'
import StudentContactPanel from '../components/detail/StudentContactPanel'
import StudentOrganizationPanel from '../components/detail/StudentOrganizationPanel'
import StudentRfidPanel from '../components/detail/StudentRfidPanel'
import { STATUS_META } from '../utils/studentFormatters'
import { getProfileSourceMeta } from '../../../utils/profileSource'

function StudentDetailModal({
  isOpen,
  detailUser,
  detailLoading,
  canManage,
  canManageRfid,
  canEditAdditionalInfo,
  isKetuaKelas,
  getKelasKetua,
  getNamaKelas,
  gradeLabels,
  moveGrade,
  moveKelas,
  kelasByGrade,
  getGradeLabel,
  getKelasDisplayName,
  rfidInput,
  rfidEnrolling,
  rfidLastScan,
  editingPhone,
  editPhoneForm,
  phoneErrors,
  orgMember,
  osisRow,
  editingAdditionalInfo,
  savingAdditionalInfo,
  editAdditionalInfoForm,
  additionalInfoErrors,
  onDeactivate,
  onActivate,
  onMutasi,
  onClose,
  onMoveGradeChange,
  onMoveKelasChange,
  onSaveClass,
  onClearClass,
  onRfidInputChange,
  onToggleRfidListen,
  onSaveRfid,
  onClearRfid,
  onEditPhone,
  onCancelEditPhone,
  onPhoneChange,
  onSavePhone,
  onDeleteOrg,
  onDeleteOsis,
  onEditAdditionalInfo,
  onCancelEditAdditionalInfo,
  onAdditionalInfoChange,
  onSaveAdditionalInfo,
}) {
  if (!isOpen) return null
  const sourceMeta = getProfileSourceMeta(detailUser?.created_via)
  const canMutasi = !['mutasi', 'alumni'].includes(String(detailUser?.status || '').toLowerCase())

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b bg-gray-50 flex items-start justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex-shrink-0 h-12 w-12">
              <ProfileAvatar
                src={detailUser?.photo_path || detailUser?.photo_url}
                name={detailUser?.nama}
                size={48}
                className="border-gray-200"
                fallbackClassName="rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-base font-semibold text-blue-600"
              />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-lg font-semibold text-gray-900">
                  {detailUser?.nama || detailUser?.email}
                </h3>
                {!canManage && (
                  <Badge variant="info" className="text-xs">
                    Wali Kelas - Read-only
                  </Badge>
                )}
                {isKetuaKelas(detailUser?.id) && (
                  <Badge variant="warning" className="text-xs">
                    Ketua {getKelasKetua(detailUser?.id)}
                  </Badge>
                )}
                {detailUser?.status && detailUser.status !== 'active' && (
                  <Badge variant={STATUS_META(detailUser.status).variant} className="text-xs">
                    {STATUS_META(detailUser.status).icon} {STATUS_META(detailUser.status).label}
                  </Badge>
                )}
                <Badge variant={sourceMeta.variant} className="text-xs">
                  {sourceMeta.label}
                </Badge>
              </div>
              <p className="text-gray-600 text-sm mt-1">
                {detailUser?.email || '-'} - NIS: {detailUser?.nis || '-'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {canManage && (
              <>
                {detailUser?.status === 'active' ? (
                  <Button variant="warning" size="sm" onClick={() => onDeactivate(detailUser)}>
                    Nonaktif
                  </Button>
                ) : (
                  <Button variant="success" size="sm" onClick={() => onActivate(detailUser)}>
                    Aktifkan
                  </Button>
                )}
                {canMutasi && (
                  <Button variant="warning" size="sm" onClick={() => onMutasi(detailUser)}>
                    Mutasi
                  </Button>
                )}
              </>
            )}
            <button
              className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              onClick={onClose}
              type="button"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {detailLoading ? (
            <div className="space-y-4">
              <div className="animate-pulse h-16 bg-gray-200 rounded-lg" />
              <div className="animate-pulse h-24 bg-gray-200 rounded-lg" />
              <div className="animate-pulse h-20 bg-gray-200 rounded-lg" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <StudentClassStatusPanel
                  detailUser={detailUser}
                  canManage={canManage}
                  moveGrade={moveGrade}
                  moveKelas={moveKelas}
                  gradeLabels={gradeLabels}
                  onMoveGradeChange={onMoveGradeChange}
                  onMoveKelasChange={onMoveKelasChange}
                  onSaveClass={onSaveClass}
                  onClearClass={onClearClass}
                  getGradeLabel={getGradeLabel}
                  getKelasDisplayName={getKelasDisplayName}
                  getNamaKelas={getNamaKelas}
                  kelasByGrade={kelasByGrade}
                />
                <StudentRfidPanel
                  detailUser={detailUser}
                  rfidInput={rfidInput}
                  canManageRfid={canManageRfid}
                  rfidEnrolling={rfidEnrolling}
                  rfidLastScan={rfidLastScan}
                  onRfidInputChange={onRfidInputChange}
                  onToggleListen={onToggleRfidListen}
                  onSave={onSaveRfid}
                  onClear={onClearRfid}
                />
              </div>

              <StudentContactPanel
                detailUser={detailUser}
                canManage={canManage}
                editingPhone={editingPhone}
                editPhoneForm={editPhoneForm}
                phoneErrors={phoneErrors}
                onEdit={onEditPhone}
                onCancel={onCancelEditPhone}
                onChange={onPhoneChange}
                onSave={onSavePhone}
              />

              <StudentOrganizationPanel
                orgMember={orgMember}
                osisRow={osisRow}
                canManage={canManage}
                onDeleteOrg={onDeleteOrg}
                onDeleteOsis={onDeleteOsis}
              />

              <StudentAdditionalInfoPanel
                detailUser={detailUser}
                canEdit={canEditAdditionalInfo}
                editing={editingAdditionalInfo}
                saving={savingAdditionalInfo}
                form={editAdditionalInfoForm}
                errors={additionalInfoErrors}
                onEdit={onEditAdditionalInfo}
                onCancel={onCancelEditAdditionalInfo}
                onChange={onAdditionalInfoChange}
                onSave={onSaveAdditionalInfo}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(StudentDetailModal)
