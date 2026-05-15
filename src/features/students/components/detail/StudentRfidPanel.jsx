import React, { memo } from 'react'
import { Button, Input } from '../../../../pages/admin/siswa/SiswaUi'

function StudentRfidPanel({
  detailUser,
  rfidInput,
  canManageRfid,
  rfidEnrolling,
  rfidLastScan,
  onRfidInputChange,
  onToggleListen,
  onSave,
  onClear
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h4 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <span>-</span>
        Kartu RFID
      </h4>

      <div className="space-y-3">
        <div>
          <Input
            label="UID RFID"
            value={rfidInput}
            onChange={e => onRfidInputChange(e.target.value.toUpperCase())}
            placeholder="Tap kartu atau isi manual"
            disabled={!canManageRfid}
          />
          {detailUser?.rfid_uid && (
            <p className="text-xs text-gray-500 mt-1">
              UID tersimpan:{' '}
              <span className="font-mono font-medium">
                {(detailUser.rfid_uid || '').toUpperCase()}
              </span>
            </p>
          )}
        </div>

        {canManageRfid && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Button
              variant={rfidEnrolling ? 'warning' : 'primary'}
              size="sm"
              onClick={onToggleListen}
            >
              {rfidEnrolling ? 'Stop' : 'Scan'}
            </Button>
            <Button variant="success" size="sm" onClick={onSave} disabled={!rfidInput}>
              Simpan
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onClear}
              disabled={!detailUser?.rfid_uid && !rfidInput}
            >
              Hapus
            </Button>
          </div>
        )}

        {rfidLastScan && (
          <div className="text-xs text-gray-500">
            Terakhir scan: <span className="font-mono">{(rfidLastScan.card_uid || '').toUpperCase()}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(StudentRfidPanel)
