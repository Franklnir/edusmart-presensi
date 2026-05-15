import React from 'react'

export default function AttendanceBadge({ children, variant = 'default', className = '' }) {
  const variants = {
    default: 'bg-slate-100 text-slate-800 border border-slate-200',
    hadir: 'bg-green-100 text-green-800 border border-green-300',
    izin: 'bg-yellow-100 text-yellow-800 border border-yellow-300',
    sakit: 'bg-blue-100 text-blue-800 border border-blue-300',
    alpha: 'bg-red-100 text-red-800 border border-red-300',
    live: 'bg-green-500 text-white',
    warning: 'bg-amber-100 text-amber-800 border border-amber-300',
    info: 'bg-blue-100 text-blue-800 border border-blue-300',
    success: 'bg-green-100 text-green-800 border border-green-300'
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  )
}
