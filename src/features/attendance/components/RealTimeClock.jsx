import React, { useEffect, useState } from 'react'

export default function RealTimeClock() {
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="bg-gradient-to-r from-white to-blue-50 border border-blue-100 rounded-2xl px-4 py-3 shadow-sm">
      <div className="text-center">
        <div className="text-[11px] uppercase tracking-wide text-blue-600 font-semibold mb-1">Waktu Real-time</div>
        <div className="text-base font-semibold font-mono text-slate-800">
          {currentTime.toLocaleTimeString('id-ID')}
        </div>
        <div className="text-xs text-slate-600 mt-1">
          {currentTime.toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })}
        </div>
      </div>
    </div>
  )
}
