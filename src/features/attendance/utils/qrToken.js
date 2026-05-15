export const extractQrToken = (rawValue = '') => {
  const value = String(rawValue || '').trim()
  if (!value) return ''

  try {
    const url = new URL(value)
    return (
      url.searchParams.get('qr') ||
      url.searchParams.get('token') ||
      url.searchParams.get('attendance_qr') ||
      value
    )
  } catch {
    const match = value.match(/(?:^|[?&])(qr|token|attendance_qr)=([^&#]+)/)
    if (match?.[2]) {
      try {
        return decodeURIComponent(match[2])
      } catch {
        return match[2]
      }
    }
    return value
  }
}
