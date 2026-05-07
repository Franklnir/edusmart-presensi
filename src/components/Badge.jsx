import React from 'react'

const colorByStatus = {
  Hadir: 'bg-green-100 text-green-700',
  Izin: 'bg-yellow-100 text-yellow-700',
  Sakit: 'bg-orange-100 text-orange-700',
  Alpha: 'bg-red-100 text-red-700',
  default: 'bg-gray-100 text-gray-700'
}

const Badge = ({ status }) => {
  const cls = colorByStatus[status] || colorByStatus.default
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}

export default Badge
