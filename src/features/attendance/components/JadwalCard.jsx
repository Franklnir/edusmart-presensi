import React, { useEffect, useState } from 'react'
import AttendanceBadge from './AttendanceBadge'
import { toMinutes } from '../utils/attendanceDate'

export default function JadwalCard({
  jadwal,
  currentTime,
  isCurrent,
  onAbsenClick,
  onCalendarClick
}) {
  const [waktuSisa, setWaktuSisa] = useState('')

  useEffect(() => {
    const calculateWaktuSisa = () => {
      if (!jadwal.jam_selesai) return ''

      const now = currentTime
      const [jam, menit] = jadwal.jam_selesai.split(':').map(Number)
      const selesai = new Date()
      selesai.setHours(jam, menit, 0, 0)

      if (now > selesai) return 'Selesai'

      const diff = selesai - now
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

      if (hours > 0) return `${hours}j ${minutes}m`
      return `${minutes}m`
    }

    setWaktuSisa(calculateWaktuSisa())
    const interval = setInterval(() => setWaktuSisa(calculateWaktuSisa()), 60000)
    return () => clearInterval(interval)
  }, [jadwal.jam_selesai, currentTime])

  const isSesiAktif = () => {
    if (!jadwal.jam_mulai || !jadwal.jam_selesai) return false
    const now = currentTime
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const startMinutes = toMinutes(jadwal.jam_mulai)
    const endMinutes = toMinutes(jadwal.jam_selesai)
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes
  }

  const getCardStyle = () => {
    if (isCurrent && isSesiAktif() && jadwal.allow_self_absen && !jadwal.status) {
      return 'border-green-400 bg-green-50'
    }
    if (isCurrent) return 'border-blue-400 bg-blue-50'
    if (jadwal.status) return 'border-blue-300 bg-blue-50'
    return 'border-slate-200 bg-white'
  }

  const isSesiAktifFlag = isSesiAktif()
  const canSelfAttend = isCurrent && isSesiAktifFlag && jadwal.allow_self_absen && !jadwal.status

  return (
    <div className={`rounded-2xl border p-4 transition-all duration-200 shadow-sm hover:shadow-md ${getCardStyle()}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center space-x-2">
          <div
            className={`w-2 h-2 rounded-full ${canSelfAttend
              ? 'bg-green-500 animate-pulse'
              : isCurrent
                ? 'bg-blue-500'
                : jadwal.status
                  ? 'bg-blue-400'
                  : 'bg-slate-400'
              }`}
          />
          <div>
            <h3 className="font-semibold text-slate-900 text-sm">{jadwal.mapel}</h3>
            <p className="text-xs text-slate-600">{jadwal.guru_nama || 'Guru'}</p>
          </div>
        </div>
        <div className="flex flex-col items-end space-y-1">
          {isCurrent && <AttendanceBadge variant="live" className="text-[10px]">SEKARANG</AttendanceBadge>}
          {waktuSisa && !isSesiAktifFlag && (
            <AttendanceBadge variant="info" className="text-[10px]">{waktuSisa}</AttendanceBadge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="text-center p-2 bg-white rounded-xl border border-slate-200">
          <div className="text-[11px] text-slate-600">Mulai</div>
          <div className="font-semibold text-slate-900 text-sm">
            {jadwal.jam_mulai}
          </div>
        </div>
        <div className="text-center p-2 bg-white rounded-xl border border-slate-200">
          <div className="text-[11px] text-slate-600">Selesai</div>
          <div className="font-semibold text-slate-900 text-sm">
            {jadwal.jam_selesai}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <AttendanceBadge variant={jadwal.allow_self_absen ? 'hadir' : 'warning'}>
          {jadwal.allow_self_absen ? 'Mandiri Dibuka' : 'Mandiri Ditutup'}
        </AttendanceBadge>
        {jadwal.status && (
          <AttendanceBadge
            variant={
              jadwal.status === 'Hadir'
                ? 'hadir'
                : jadwal.status === 'Izin'
                  ? 'izin'
                  : jadwal.status === 'Sakit'
                    ? 'sakit'
                    : 'alpha'
            }
          >
            {jadwal.status}
          </AttendanceBadge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {canSelfAttend && (
          <button
            className="w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold transition-all duration-200 text-[11px]"
            onClick={() => onAbsenClick(jadwal)}
          >
            Absen
          </button>
        )}
        <button
          className={`w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all duration-200 text-[11px] ${canSelfAttend ? '' : 'col-span-2'}`}
          onClick={() => onCalendarClick(jadwal)}
        >
          Kalender
        </button>
      </div>
    </div>
  )
}
