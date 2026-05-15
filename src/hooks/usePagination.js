import { useCallback, useEffect, useMemo, useState } from 'react'

export function usePagination(items = [], { pageSize = 25, initialPage = 1 } = {}) {
  const [page, setPage] = useState(initialPage)
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    setPage((current) => Math.min(Math.max(1, current), pageCount))
  }, [pageCount])

  const startIndex = total === 0 ? 0 : (page - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, total)

  const paginatedItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [items, startIndex, endIndex]
  )

  const goToPage = useCallback((nextPage) => {
    setPage(Math.min(Math.max(1, Number(nextPage) || 1), pageCount))
  }, [pageCount])

  const nextPage = useCallback(() => {
    setPage((current) => Math.min(current + 1, pageCount))
  }, [pageCount])

  const previousPage = useCallback(() => {
    setPage((current) => Math.max(current - 1, 1))
  }, [])

  return {
    items: paginatedItems,
    total,
    page,
    pageCount,
    pageSize,
    startIndex,
    endIndex,
    canPreviousPage: page > 1,
    canNextPage: page < pageCount,
    goToPage,
    nextPage,
    previousPage,
  }
}

export default usePagination
