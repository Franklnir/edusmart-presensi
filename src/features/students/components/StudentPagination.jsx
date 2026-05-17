import React, { memo } from 'react'
import { Button } from '../../../pages/admin/siswa/SiswaUi'

function StudentPagination({ pagination }) {
  if (!pagination?.total) return null

  return (
    <div className="flex flex-col gap-3 border-t border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-gray-600">
        Menampilkan {pagination.startIndex + 1}-{pagination.endIndex} dari {pagination.total} siswa
        {pagination.isLoading ? ' • memuat...' : ''}
      </p>
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={pagination.previousPage}
          disabled={!pagination.canPreviousPage || pagination.isLoading}
        >
          Sebelumnya
        </Button>
        <span className="text-sm font-medium text-gray-700">
          Halaman {pagination.page} / {pagination.pageCount}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={pagination.nextPage}
          disabled={!pagination.canNextPage || pagination.isLoading}
        >
          Berikutnya
        </Button>
      </div>
    </div>
  )
}

export default memo(StudentPagination)
