// src/components/Toast.jsx
import React, { useEffect } from 'react'
import { useUIStore } from '../store/useUIStore'

const TYPE_STYLES = {
  success:
    'bg-emerald-500/95 border-emerald-300 text-white shadow-emerald-500/30',
  error:
    'bg-red-500/95 border-red-300 text-white shadow-red-500/30',
  warning:
    'bg-amber-500/95 border-amber-300 text-white shadow-amber-500/30',
  info:
    'bg-blue-500/95 border-blue-300 text-white shadow-blue-500/30',
  default:
    'bg-slate-800/95 border-slate-600 text-white shadow-slate-800/40'
}

const TYPE_ICON = {
  success: '✅',
  error: '⚠️',
  warning: '⚠️',
  info: 'ℹ️',
  default: '🔔'
}

const Toast = () => {
  const { toasts, removeToast } = useUIStore()

  useEffect(() => {
    if (!toasts.length) return

    // bikin timeout per-toast, pakai duration kalau ada
    const timers = toasts.map((t) => {
      const duration = t.duration ?? 3500 // default 3.5 detik
      return setTimeout(() => removeToast(t.id), duration)
    })

    return () => {
      timers.forEach(clearTimeout)
    }
  }, [toasts, removeToast])

  if (!toasts.length) return null

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-full max-w-xs sm:max-w-sm">
      {toasts.map((t) => {
        const type = t.type || 'default'
        const styleClass = TYPE_STYLES[type] || TYPE_STYLES.default
        const icon = TYPE_ICON[type] || TYPE_ICON.default

        return (
          <div
            key={t.id}
            className={`relative flex items-start gap-3 px-4 py-3 rounded-2xl border shadow-lg backdrop-blur-sm ${styleClass}`}
          >
            <div className="mt-0.5 text-lg">
              {icon}
            </div>

            <div className="flex-1">
              {/* Optional title dari store, kalau ada */}
              {t.title && (
                <div className="text-xs font-semibold opacity-90 mb-0.5">
                  {t.title}
                </div>
              )}
              <div className="text-sm leading-snug">
                {t.message}
              </div>
            </div>

            <button
              onClick={() => removeToast(t.id)}
              className="ml-2 text-xs opacity-80 hover:opacity-100 hover:scale-110 transition-transform"
              aria-label="Close notification"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default Toast
