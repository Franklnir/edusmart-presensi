import { useCallback } from 'react'

export function useAttendanceRfidSettings() {
  const isInRfidTimeRange = useCallback(() => true, [])

  return {
    isInRfidTimeRange,
  }
}
